//! WASAPI capture for the recorder: system audio via loopback, mic via normal
//! capture. Each source runs on its own thread, pushing interleaved f32le PCM
//! into an mpsc channel that a tokio task drains into a named pipe. Recorder-owned.
//!
//! Spike note: the WASAPI objects (`AudioClient`, `AudioCaptureClient`, the event
//! `Handle`) wrap COM interfaces that aren't `Send`, so — like the `wasapi`
//! crate's own examples — they are created and used entirely ON the capture
//! thread. The negotiated format is handed back to the caller through a tiny
//! sync channel, which also doubles as the init-error path; that keeps the
//! `start_capture` signature (return the format up front) without moving any COM
//! object across a thread boundary.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

#[derive(Clone, Copy, Debug)]
pub enum Source {
    System,
    Mic,
}

#[derive(Clone, Copy, Debug)]
pub struct CaptureFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

/// Open `source` and start capturing. Returns the negotiated format, a receiver of
/// raw f32le byte buffers, and the capture thread handle. While `muted`, the thread
/// emits equal-length silence (keeps A/V timeline + sync). On `stop`, it exits and
/// drops its sender (closing the channel, which ends the pipe pump → ffmpeg EOF).
pub fn start_capture(
    source: Source,
    muted: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
) -> Result<(CaptureFormat, UnboundedReceiver<Vec<u8>>, JoinHandle<()>), String> {
    let (tx, rx) = unbounded_channel::<Vec<u8>>();
    // Carries the negotiated format back from the capture thread, or the first
    // open error if WASAPI init fails. Closed (Err on recv) only if the thread
    // panics before reporting.
    let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<CaptureFormat, String>>();

    let handle = std::thread::spawn(move || {
        use wasapi::*;

        // All WASAPI/COM work lives here so nothing non-Send crosses threads.
        // Open the client; on any failure report it and bail before the loop.
        let opened = (|| -> Result<(AudioClient, AudioCaptureClient, Handle, CaptureFormat), String> {
            initialize_mta()
                .ok()
                .map_err(|e| format!("WASAPI COM init failed: {e}"))?;

            // System audio = default RENDER device opened in loopback. The crate
            // derives loopback automatically when the device is a render device
            // but the requested stream direction is Capture.
            let dev_dir = match source {
                Source::System => &Direction::Render,
                Source::Mic => &Direction::Capture,
            };
            let device =
                get_default_device(dev_dir).map_err(|e| format!("default device: {e}"))?;
            let mut client = device
                .get_iaudioclient()
                .map_err(|e| format!("audio client: {e}"))?;

            // Take the device's shared-mode mix format for rate/channels, but
            // request an explicit 32-bit float format with auto-convert so the
            // bytes we emit are ALWAYS interleaved f32le (the channel contract),
            // regardless of the device's native sample type.
            let mixfmt = client
                .get_mixformat()
                .map_err(|e| format!("mix format: {e}"))?;
            let sample_rate = mixfmt.get_samplespersec();
            let channels = mixfmt.get_nchannels();
            let desired = WaveFormat::new(
                32,
                32,
                &SampleType::Float,
                sample_rate as usize,
                channels as usize,
                None,
            );

            let (_def, min) = client
                .get_periods()
                .map_err(|e| format!("periods: {e}"))?;
            // Stream direction is Capture for both sources (render+Capture ⇒
            // loopback inside the crate). `convert = true` enables AUTOCONVERTPCM.
            client
                .initialize_client(&desired, min, &Direction::Capture, &ShareMode::Shared, true)
                .map_err(|e| format!("init client: {e}"))?;
            let h_event = client
                .set_get_eventhandle()
                .map_err(|e| format!("event handle: {e}"))?;
            let capture = client
                .get_audiocaptureclient()
                .map_err(|e| format!("capture client: {e}"))?;
            client
                .start_stream()
                .map_err(|e| format!("start stream: {e}"))?;

            Ok((client, capture, h_event, CaptureFormat { sample_rate, channels }))
        })();

        let (client, capture, h_event, _fmt) = match opened {
            Ok(parts) => {
                // Report the negotiated format. If the receiver is already gone
                // (caller dropped), there's no point capturing.
                if init_tx.send(Ok(parts.3)).is_err() {
                    let _ = parts.0.stop_stream();
                    return;
                }
                parts
            }
            Err(e) => {
                let _ = init_tx.send(Err(e));
                return;
            }
        };

        let mut queue: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
        while !stop.load(Ordering::Relaxed) {
            if h_event.wait_for_event(200).is_err() {
                continue; // timeout; re-check stop
            }
            if capture.read_from_device_to_deque(&mut queue).is_err() {
                break;
            }
            if queue.is_empty() {
                continue;
            }
            let mut buf: Vec<u8> = queue.drain(..).collect();
            if muted.load(Ordering::Relaxed) {
                buf.iter_mut().for_each(|b| *b = 0); // f32 zero bytes == 0.0 == silence
            }
            if tx.send(buf).is_err() {
                break; // pump dropped (pipe gone)
            }
        }
        let _ = client.stop_stream();
        // tx dropped here → channel closes → pipe pump finishes.
    });

    match init_rx.recv() {
        Ok(Ok(fmt)) => Ok((fmt, rx, handle)),
        Ok(Err(e)) => {
            let _ = handle.join();
            Err(e)
        }
        Err(_) => {
            let _ = handle.join();
            Err("capture thread exited before reporting format".into())
        }
    }
}
