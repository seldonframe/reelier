use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use std::fs::TryLockError;
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path};

pub const PROTOCOL: &str = "reelier.bootstrap-native-helper/v2";
const LOCK_NAME: &str = ".reelier-bootstrap.lock";
const MAX_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenSessionRequest {
    pub v: String,
    pub root: String,
    pub lock_name: String,
    pub lock_bytes_hex: String,
    pub owner_token: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AcquisitionResponse {
    pub v: &'static str,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_bytes_hex: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Command {
    ReplaceLock {
        id: String,
        owner_token: String,
        bytes_hex: String,
    },
    Mkdir {
        id: String,
        owner_token: String,
        path: String,
    },
    WriteExclusive {
        id: String,
        owner_token: String,
        path: String,
        bytes_hex: String,
    },
    WriteAtomic {
        id: String,
        owner_token: String,
        path: String,
        bytes_hex: String,
    },
    Rename {
        id: String,
        owner_token: String,
        from: String,
        to: String,
    },
    Remove {
        id: String,
        owner_token: String,
        path: String,
        recursive: bool,
        missing_ok: bool,
    },
    Close {
        id: String,
        owner_token: String,
        remove_lock: bool,
    },
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CommandResponse {
    pub v: &'static str,
    pub id: String,
    pub status: &'static str,
}

pub struct Session {
    dir: Dir,
    lock_file: Option<std::fs::File>,
    lock_name: String,
    owner_token: String,
    closed: bool,
}

pub enum OpenSessionResult {
    Acquired(Session, AcquisitionResponse),
    Refused(AcquisitionResponse),
}

pub fn probe_json() -> String {
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    };
    format!(
        r#"{{"v":"{PROTOCOL}","status":"ready","platform":"{platform}","architecture":"x64","operations":["persistent-lock","mkdir","write-exclusive","write-atomic","rename","remove"]}}"#
    )
}

pub fn open_session(request: OpenSessionRequest) -> OpenSessionResult {
    if request.v != PROTOCOL || request.lock_name != LOCK_NAME || !valid_token(&request.owner_token)
    {
        return refused("refused");
    }
    let Ok(lock_bytes) = decode_bytes(&request.lock_bytes_hex) else {
        return refused("refused");
    };
    let root = Path::new(&request.root);
    if !root.is_absolute() {
        return refused("refused");
    }
    let Ok(dir) = Dir::open_ambient_dir(root, ambient_authority()) else {
        return refused("refused");
    };
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    let Ok(file) = dir.open_with(LOCK_NAME, &options) else {
        return refused("refused");
    };
    let mut lock_file = file.into_std();
    match lock_file.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return refused("busy"),
        Err(TryLockError::Error(_)) => return refused("refused"),
    }
    let mut prior = Vec::new();
    if lock_file.seek(SeekFrom::Start(0)).is_err()
        || Read::by_ref(&mut lock_file)
            .take((MAX_BYTES + 1) as u64)
            .read_to_end(&mut prior)
            .is_err()
        || prior.len() > MAX_BYTES
    {
        return refused("refused");
    }
    let status;
    let prior_bytes_hex;
    if prior.is_empty() {
        if replace_open_file(&mut lock_file, &lock_bytes).is_err() {
            return refused("refused");
        }
        status = "created";
        prior_bytes_hex = None;
    } else {
        status = "recovered";
        prior_bytes_hex = Some(hex::encode(prior));
    }
    OpenSessionResult::Acquired(
        Session {
            dir,
            lock_file: Some(lock_file),
            lock_name: LOCK_NAME.into(),
            owner_token: request.owner_token,
            closed: false,
        },
        AcquisitionResponse {
            v: PROTOCOL,
            status,
            prior_bytes_hex,
        },
    )
}

impl Session {
    pub fn execute(&mut self, command: Command) -> CommandResponse {
        let id = command.id().to_owned();
        if self.closed || !valid_id(&id) || command.owner_token() != self.owner_token {
            return response(id, "refused");
        }
        let status = match command {
            Command::ReplaceLock { bytes_hex, .. } => self.replace_lock(&bytes_hex),
            Command::Mkdir { path, .. } => self.mkdir(&path),
            Command::WriteExclusive {
                path, bytes_hex, ..
            } => self.write_exclusive(&path, &bytes_hex),
            Command::WriteAtomic {
                id,
                path,
                bytes_hex,
                ..
            } => self.write_atomic(&id, &path, &bytes_hex),
            Command::Rename { from, to, .. } => self.rename(&from, &to),
            Command::Remove {
                path,
                recursive,
                missing_ok,
                ..
            } => self.remove(&path, recursive, missing_ok),
            Command::Close { remove_lock, .. } => return self.close(id, remove_lock),
        };
        response(id, status)
    }

    fn replace_lock(&mut self, bytes_hex: &str) -> &'static str {
        let Ok(bytes) = decode_bytes(bytes_hex) else {
            return "refused";
        };
        let Some(file) = self.lock_file.as_mut() else {
            return "refused";
        };
        if replace_open_file(file, &bytes).is_ok() {
            "ok"
        } else {
            "refused"
        }
    }

    fn mkdir(&self, relative: &str) -> &'static str {
        if !valid_relative(relative) {
            return "refused";
        }
        match self.dir.create_dir(relative) {
            Ok(()) => "ok",
            Err(error) if error.kind() == ErrorKind::AlreadyExists => "exists",
            Err(_) => "refused",
        }
    }

    fn write_exclusive(&self, relative: &str, bytes_hex: &str) -> &'static str {
        if !valid_relative(relative) {
            return "refused";
        }
        let Ok(bytes) = decode_bytes(bytes_hex) else {
            return "refused";
        };
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        match self.dir.open_with(relative, &options) {
            Ok(mut file) => {
                if file.write_all(&bytes).and_then(|_| file.sync_all()).is_ok() {
                    "ok"
                } else {
                    "refused"
                }
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => "exists",
            Err(_) => "refused",
        }
    }

    fn write_atomic(&self, id: &str, relative: &str, bytes_hex: &str) -> &'static str {
        if !valid_relative(relative) {
            return "refused";
        }
        let Ok(bytes) = decode_bytes(bytes_hex) else {
            return "refused";
        };
        let path = Path::new(relative);
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            return "refused";
        };
        let temporary_name = format!(".{name}.native-{id}.tmp");
        let temporary = match path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent.join(temporary_name),
            _ => temporary_name.into(),
        };
        let temporary_text = temporary.to_string_lossy().replace('\\', "/");
        let status = self.write_exclusive(&temporary_text, bytes_hex);
        if status != "ok" {
            return status;
        }
        let result = self.dir.rename(&temporary, &self.dir, path);
        if result.is_err() {
            let _ = self.dir.remove_file(&temporary);
            return "refused";
        }
        "ok"
    }

    fn rename(&self, from: &str, to: &str) -> &'static str {
        if !valid_relative(from) || !valid_relative(to) {
            return "refused";
        }
        match self.dir.rename(from, &self.dir, to) {
            Ok(()) => "ok",
            Err(error) if error.kind() == ErrorKind::NotFound => "absent",
            Err(error) if error.kind() == ErrorKind::AlreadyExists => "exists",
            Err(_) => "refused",
        }
    }

    fn remove(&self, relative: &str, recursive: bool, missing_ok: bool) -> &'static str {
        if !valid_relative(relative) || relative == self.lock_name {
            return "refused";
        }
        let result = if recursive {
            self.dir.remove_dir_all(relative)
        } else {
            self.dir.remove_file(relative)
        };
        match result {
            Ok(()) => "ok",
            Err(error) if missing_ok && error.kind() == ErrorKind::NotFound => "ok",
            Err(error) if error.kind() == ErrorKind::NotFound => "absent",
            Err(_) => "refused",
        }
    }

    fn close(&mut self, id: String, remove_lock: bool) -> CommandResponse {
        self.closed = true;
        if let Some(file) = self.lock_file.take() {
            let _ = file.unlock();
            drop(file);
        }
        let status = if remove_lock {
            match self.dir.remove_file(&self.lock_name) {
                Ok(()) => "ok",
                Err(error) if error.kind() == ErrorKind::NotFound => "ok",
                Err(_) => "refused",
            }
        } else {
            "ok"
        };
        response(id, status)
    }
}

impl Command {
    fn id(&self) -> &str {
        match self {
            Self::ReplaceLock { id, .. }
            | Self::Mkdir { id, .. }
            | Self::WriteExclusive { id, .. }
            | Self::WriteAtomic { id, .. }
            | Self::Rename { id, .. }
            | Self::Remove { id, .. }
            | Self::Close { id, .. } => id,
        }
    }
    fn owner_token(&self) -> &str {
        match self {
            Self::ReplaceLock { owner_token, .. }
            | Self::Mkdir { owner_token, .. }
            | Self::WriteExclusive { owner_token, .. }
            | Self::WriteAtomic { owner_token, .. }
            | Self::Rename { owner_token, .. }
            | Self::Remove { owner_token, .. }
            | Self::Close { owner_token, .. } => owner_token,
        }
    }
}

fn replace_open_file(file: &mut std::fs::File, bytes: &[u8]) -> std::io::Result<()> {
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(bytes)?;
    file.sync_all()
}
fn decode_bytes(value: &str) -> Result<Vec<u8>, ()> {
    if value.len() > MAX_BYTES * 2 || value.len() % 2 != 0 {
        return Err(());
    }
    hex::decode(value).map_err(|_| ())
}
fn valid_token(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
fn valid_id(value: &str) -> bool {
    value.len() == 16
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn valid_relative(value: &str) -> bool {
    !value.is_empty() && !value.contains('\\') && !value.contains(':') && Path::new(value).components().all(|part| matches!(part, Component::Normal(name) if !name.is_empty() && name.to_string_lossy().bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._~-".contains(&byte))))
}
fn response(id: String, status: &'static str) -> CommandResponse {
    CommandResponse {
        v: PROTOCOL,
        id,
        status,
    }
}
fn refused(status: &'static str) -> OpenSessionResult {
    OpenSessionResult::Refused(AcquisitionResponse {
        v: PROTOCOL,
        status,
        prior_bytes_hex: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> std::path::PathBuf {
        let value = std::env::temp_dir().join(format!(
            "reelier-native-session-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&value).unwrap();
        value
    }
    fn open(root: &Path, owner: &str) -> OpenSessionResult {
        open_session(OpenSessionRequest {
            v: PROTOCOL.into(),
            root: root.to_string_lossy().into_owned(),
            lock_name: LOCK_NAME.into(),
            lock_bytes_hex: hex::encode(b"lock-one"),
            owner_token: owner.into(),
        })
    }
    fn command(id: &str, owner: &str, path: &str) -> Command {
        Command::Mkdir {
            id: id.into(),
            owner_token: owner.into(),
            path: path.into(),
        }
    }

    #[test]
    fn session_holds_lock_and_binds_commands_to_owner() {
        let root = root();
        let owner = &"a".repeat(64);
        let OpenSessionResult::Acquired(mut first, acquired) = open(&root, owner) else {
            panic!("first session refused")
        };
        assert_eq!(acquired.status, "created");
        let OpenSessionResult::Refused(busy) = open(&root, &"b".repeat(64)) else {
            panic!("second session acquired")
        };
        assert_eq!(busy.status, "busy");
        assert_eq!(
            first
                .execute(command("0000000000000001", &"b".repeat(64), "child"))
                .status,
            "refused"
        );
        assert_eq!(
            first
                .execute(command("0000000000000002", owner, "child"))
                .status,
            "ok"
        );
        assert!(root.join("child").is_dir());
        assert_eq!(
            first
                .execute(Command::Close {
                    id: "0000000000000003".into(),
                    owner_token: owner.into(),
                    remove_lock: false
                })
                .status,
            "ok"
        );
        let OpenSessionResult::Acquired(_, recovered) = open(&root, owner) else {
            panic!("orphan recovery refused")
        };
        assert_eq!(recovered.status, "recovered");
        assert_eq!(
            recovered.prior_bytes_hex.as_deref(),
            Some("6c6f636b2d6f6e65")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn relative_mutations_refuse_escape_and_publish_inside_root() {
        let root = root();
        let owner = &"c".repeat(64);
        let OpenSessionResult::Acquired(mut session, _) = open(&root, owner) else {
            panic!("session refused")
        };
        assert_eq!(
            session
                .execute(command("0000000000000001", owner, "stage"))
                .status,
            "ok"
        );
        assert_eq!(
            session
                .execute(Command::WriteExclusive {
                    id: "0000000000000002".into(),
                    owner_token: owner.into(),
                    path: "stage/value".into(),
                    bytes_hex: "616263".into()
                })
                .status,
            "ok"
        );
        assert_eq!(
            session
                .execute(Command::Rename {
                    id: "0000000000000003".into(),
                    owner_token: owner.into(),
                    from: "stage/value".into(),
                    to: "stage/final".into()
                })
                .status,
            "ok"
        );
        assert_eq!(fs::read(root.join("stage/final")).unwrap(), b"abc");
        assert_eq!(
            session
                .execute(command("0000000000000004", owner, "../outside"))
                .status,
            "refused"
        );
        assert_eq!(
            session
                .execute(Command::Close {
                    id: "0000000000000005".into(),
                    owner_token: owner.into(),
                    remove_lock: true
                })
                .status,
            "ok"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
