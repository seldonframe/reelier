use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{ErrorKind, Read, Write};
use std::path::Path;

pub const PROTOCOL: &str = "reelier.bootstrap-native-helper/v1";
const LOCK_NAME: &str = ".reelier-bootstrap.lock";
const MAX_LOCK_BYTES: usize = 4096;

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    CreateLock {
        root: String,
        name: String,
        contents_hex: String,
    },
    RemoveOwnedRelative {
        root: String,
        name: String,
        expected_sha256: String,
    },
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Response {
    pub v: &'static str,
    pub status: &'static str,
}

pub fn probe_json() -> String {
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    };
    format!(
        r#"{{"v":"{PROTOCOL}","status":"ready","platform":"{platform}","architecture":"x64","operations":["create-lock","remove-owned-relative"]}}"#
    )
}

pub fn execute(request: Request) -> Response {
    match request {
        Request::CreateLock {
            root,
            name,
            contents_hex,
        } => create_lock(&root, &name, &contents_hex),
        Request::RemoveOwnedRelative {
            root,
            name,
            expected_sha256,
        } => remove_owned(&root, &name, &expected_sha256),
    }
}

fn create_lock(root: &str, name: &str, contents_hex: &str) -> Response {
    let Ok((dir, bytes)) =
        open_root(root).and_then(|dir| decode_lock(name, contents_hex).map(|bytes| (dir, bytes)))
    else {
        return response("refused");
    };
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    match dir.open_with(name, &options) {
        Ok(mut file) => {
            if file.write_all(&bytes).and_then(|_| file.sync_all()).is_ok() {
                response("created")
            } else {
                response("refused")
            }
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => response("busy"),
        Err(_) => response("refused"),
    }
}

fn remove_owned(root: &str, name: &str, expected_sha256: &str) -> Response {
    if name != LOCK_NAME || !valid_sha256(expected_sha256) {
        return response("refused");
    }
    let Ok(dir) = open_root(root) else {
        return response("refused");
    };
    let Ok(mut file) = dir.open(name) else {
        return response("absent");
    };
    let mut bytes = Vec::new();
    if file
        .take((MAX_LOCK_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > MAX_LOCK_BYTES
    {
        return response("refused");
    }
    let actual = format!("sha256:{:x}", Sha256::digest(&bytes));
    if actual != expected_sha256 {
        return response("not-owned");
    }
    match dir.remove_file(name) {
        Ok(()) => response("removed"),
        Err(_) => response("refused"),
    }
}

fn open_root(root: &str) -> Result<Dir, ()> {
    let path = Path::new(root);
    if !path.is_absolute() {
        return Err(());
    }
    Dir::open_ambient_dir(path, ambient_authority()).map_err(|_| ())
}

fn decode_lock(name: &str, contents_hex: &str) -> Result<Vec<u8>, ()> {
    if name != LOCK_NAME || contents_hex.len() > MAX_LOCK_BYTES * 2 || contents_hex.len() % 2 != 0 {
        return Err(());
    }
    hex::decode(contents_hex).map_err(|_| ())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
fn response(status: &'static str) -> Response {
    Response {
        v: PROTOCOL,
        status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> std::path::PathBuf {
        let value = std::env::temp_dir().join(format!(
            "reelier-native-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&value).unwrap();
        value
    }

    #[test]
    fn probe_is_closed_and_host_specific() {
        let value: serde_json::Value = serde_json::from_str(&probe_json()).unwrap();
        assert_eq!(value["v"], PROTOCOL);
        assert_eq!(value["architecture"], "x64");
        assert_eq!(
            value["operations"],
            serde_json::json!(["create-lock", "remove-owned-relative"])
        );
    }

    #[test]
    fn lock_create_is_exclusive_and_remove_is_digest_owned() {
        let root = root();
        let root_text = root.to_str().unwrap().to_owned();
        let request = || Request::CreateLock {
            root: root_text.clone(),
            name: LOCK_NAME.into(),
            contents_hex: "616263".into(),
        };
        assert_eq!(execute(request()).status, "created");
        assert_eq!(execute(request()).status, "busy");
        assert_eq!(
            execute(Request::RemoveOwnedRelative {
                root: root_text.clone(),
                name: LOCK_NAME.into(),
                expected_sha256: format!("sha256:{}", "0".repeat(64))
            })
            .status,
            "not-owned"
        );
        assert_eq!(
            execute(Request::RemoveOwnedRelative {
                root: root_text,
                name: LOCK_NAME.into(),
                expected_sha256:
                    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into()
            })
            .status,
            "removed"
        );
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn arbitrary_relative_names_are_refused() {
        let root = root();
        assert_eq!(
            execute(Request::CreateLock {
                root: root.to_str().unwrap().into(),
                name: "../outside".into(),
                contents_hex: "00".into()
            })
            .status,
            "refused"
        );
        assert!(fs::read_dir(&root).unwrap().next().is_none());
        fs::remove_dir(root).unwrap();
    }
}
