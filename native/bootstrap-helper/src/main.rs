use reelier_bootstrap_helper::{Request, execute, probe_json};
use std::io::{self, Read};

fn main() {
    if std::env::args().nth(1).as_deref() == Some("probe") {
        println!("{}", probe_json());
        return;
    }
    let mut input = String::new();
    if io::stdin()
        .take(16 * 1024)
        .read_to_string(&mut input)
        .is_err()
    {
        refuse();
    }
    let request: Request = match serde_json::from_str(&input) {
        Ok(value) => value,
        Err(_) => refuse(),
    };
    println!(
        "{}",
        serde_json::to_string(&execute(request)).expect("closed response serializes")
    );
}

fn refuse() -> ! {
    eprintln!(r#"{{"v":"reelier.bootstrap-native-helper/v1","status":"refused"}}"#);
    std::process::exit(64)
}
