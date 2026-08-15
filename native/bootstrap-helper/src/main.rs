use reelier_bootstrap_helper::{
    Command, OpenSessionRequest, OpenSessionResult, PROTOCOL, open_session, probe_json,
};
use std::io::{self, BufRead, Write};

fn main() {
    if std::env::args().nth(1).as_deref() == Some("probe") {
        println!("{}", probe_json());
        return;
    }
    if std::env::args().nth(1).as_deref() != Some("serve") {
        refuse();
    }
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let Some(Ok(first)) = lines.next() else {
        refuse();
    };
    let request: OpenSessionRequest = match serde_json::from_str(&first) {
        Ok(value) => value,
        Err(_) => refuse(),
    };
    let (mut session, acquisition) = match open_session(request) {
        OpenSessionResult::Acquired(session, response) => (session, response),
        OpenSessionResult::Refused(response) => {
            emit(&response);
            std::process::exit(if response.status == "busy" { 73 } else { 74 });
        }
    };
    emit(&acquisition);
    for line in lines {
        let Ok(line) = line else {
            break;
        };
        let command: Command = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                eprintln!(r#"{{"v":"{PROTOCOL}","status":"refused"}}"#);
                break;
            }
        };
        let closing = matches!(command, Command::Close { .. });
        emit(&session.execute(command));
        if closing {
            return;
        }
    }
}

fn emit(value: &impl serde::Serialize) {
    println!(
        "{}",
        serde_json::to_string(value).expect("closed response serializes")
    );
    io::stdout().flush().expect("stdout flush");
}
fn refuse() -> ! {
    eprintln!(r#"{{"v":"{PROTOCOL}","status":"refused"}}"#);
    std::process::exit(64)
}
