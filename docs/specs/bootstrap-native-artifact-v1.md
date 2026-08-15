# Bootstrap native artifact contract v1

Status: packaging/loader slice only. Named initialization does not call this helper yet.

## Boundary

The universal `reelier` npm tarball carries two prebuilt executables and one closed manifest:

```text
native/bootstrap-helper/manifest.json
native/bootstrap-helper/linux-x64/reelier-bootstrap-helper
native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe
```

Installation performs no compilation, postinstall work, network download, or JavaScript fallback.
Missing, linked, malformed, wrong-host, wrong-format, or digest-mismatched artifacts are unavailable.
The loader never returns a path for an unavailable artifact.

## Manifest

`manifest.json` has exactly these keys and exactly two entries, ordered `linux-x64` then
`win32-x64`:

```json
{
  "v": "reelier.bootstrap-native-artifacts/v1",
  "protocol": "reelier.bootstrap-native-helper/v2",
  "artifacts": [
    {
      "platform": "linux",
      "architecture": "x64",
      "target": "x86_64-unknown-linux-gnu",
      "path": "native/bootstrap-helper/linux-x64/reelier-bootstrap-helper",
      "sha256": "sha256:<64 lowercase hex>"
    },
    {
      "platform": "win32",
      "architecture": "x64",
      "target": "x86_64-pc-windows-msvc",
      "path": "native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe",
      "sha256": "sha256:<64 lowercase hex>"
    }
  ]
}
```

No pending digest is valid in a published package. Paths are fixed literals, never caller input.

## Loader result

`loadBootstrapNativeArtifact` returns one of:

```ts
{ status: "verified"; protocol; platform; architecture; target; absolutePath; sha256 }
{ status: "refused"; reason }
```

The closed refusal reasons are `unsupported-platform`, `unsupported-architecture`,
`manifest-invalid`, `artifact-missing`, `artifact-unsafe`, `artifact-format-mismatch`, and
`artifact-digest-mismatch`. A refusal carries no path or native handle. The loader accepts only the
real host platform/architecture by default; test overrides are private options and do not weaken
manifest, path, file-type, native-header, or digest checks.

The loader verifies ELF64 little-endian x86-64 (`e_machine = 62`) or PE32+ AMD64
(`Machine = 0x8664`) before returning the artifact. Execution must re-run verification immediately
before spawning. A successful helper `probe` writes exactly one UTF-8 JSON line:

```json
{"v":"reelier.bootstrap-native-helper/v2","status":"ready","platform":"linux|win32","architecture":"x64","operations":["persistent-lock","mkdir","write-exclusive","write-atomic","rename","remove"]}
```

Anything else is an unverified refusal. The protocol's two mutations accept one canonical absolute
root plus closed relative basenames, use native relative filesystem operations, and never accept
shell text, callbacks, arbitrary command names, separators, `.`/`..`, or unbounded bytes.

## Build and release gate

Rust is pinned by `rust-toolchain.toml`; Cargo dependencies are exact and locked. Matching-host
Linux x64 and Windows x64 jobs build, test, execute `probe`, and compare the resulting bytes with
the checked-in manifest digest. A separate universal-pack check proves both exact files are in the
same npm tarball. A digest may be committed only from a binary that completed its matching-host
job. Cross-compilation alone is not release evidence.
