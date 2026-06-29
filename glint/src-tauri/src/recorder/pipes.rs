//! Windows named pipes that carry raw PCM from our WASAPI capture threads into
//! ffmpeg. Recorder-owned. ffmpeg opens `\\.\pipe\NAME` as a client; we are the
//! server. One pipe per (source, segment) so spans never collide.

use std::io;
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

/// `\\.\pipe\glint-{tag}-{seg}-{pid}` — unique per source/segment/process so a
/// resumed span (new segment) and a second app instance never clash.
pub fn pipe_path(tag: &str, seg: usize) -> String {
    format!("\\\\.\\pipe\\glint-{tag}-{seg}-{}", std::process::id())
}

/// Create the server end of a named pipe, listening for ffmpeg to connect.
pub fn create_server(path: &str) -> io::Result<NamedPipeServer> {
    ServerOptions::new()
        .first_pipe_instance(true)
        .create(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pipe_path_shape() {
        let p = pipe_path("sys", 0);
        assert!(p.starts_with(r"\\.\pipe\glint-sys-0-"));
    }
}
