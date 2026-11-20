//! Capture shutter sounds, played asynchronously via Win32 PlaySound. Fully local.
//!
//! Four are T3 Code's snapshot/notification sounds (MIT, see sounds/LICENSE-T3-Code.txt),
//! embedded as PCM WAVs; "classic" is Glint's original, synthesized in memory.

use std::sync::OnceLock;

/// Little-endian PCM16 mono WAV of a refined two-stage camera snap (~140 ms): a mirror-up
/// click, a shutter click ~45 ms later, over a short low-frequency body. Deterministic.
pub fn shutter_wav() -> Vec<u8> {
    let sample_rate: u32 = 44_100;
    // Lead-in silence: Windows fades the audio stream in over the first few tens of ms after
    // the endpoint has been idle, so a transient at t=0 plays attenuated on the first (cold)
    // capture. Opening with silence lets that ramp finish before the click, so every play —
    // cold or warm — sounds at full volume. ~70 ms is imperceptible as capture feedback.
    let lead = (sample_rate as f32 * 0.07) as usize;
    let n = (sample_rate as f32 * 0.14) as usize;
    let mut samples: Vec<i16> = Vec::with_capacity(lead + n);
    samples.resize(lead, 0);
    // xorshift so we need no rng dependency and stay deterministic.
    let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
    let mut noise = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        ((seed >> 40) as i32 as f32) / 8_388_608.0 - 1.0
    };
    for i in 0..n {
        let t = i as f32 / sample_rate as f32;
        let click1 = (-t * 130.0).exp(); // mirror up
        let click2 = 0.9 * (-((t - 0.045).max(0.0)) * 150.0).exp(); // shutter
        let body =
            (-t * 45.0).exp() * (2.0 * std::f32::consts::PI * 180.0 * t).sin() * 0.25;
        let s = ((noise() * (click1 + click2) * 0.6 + body) * 0.9).clamp(-1.0, 1.0);
        samples.push((s * i16::MAX as f32) as i16);
    }
    encode_wav_mono(&samples, sample_rate)
}

fn encode_wav_mono(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut v = Vec::with_capacity(44 + data_len as usize);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + data_len).to_le_bytes());
    v.extend_from_slice(b"WAVE");
    v.extend_from_slice(b"fmt ");
    v.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    v.extend_from_slice(&1u16.to_le_bytes()); // PCM
    v.extend_from_slice(&1u16.to_le_bytes()); // mono
    v.extend_from_slice(&sample_rate.to_le_bytes());
    v.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
    v.extend_from_slice(&2u16.to_le_bytes()); // block align
    v.extend_from_slice(&16u16.to_le_bytes()); // bits/sample
    v.extend_from_slice(b"data");
    v.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        v.extend_from_slice(&s.to_le_bytes());
    }
    v
}

/// Selectable shutter sounds, in menu order: (id, label).
pub const SHUTTER_SOUNDS: [(&str, &str); 5] = [
    ("click", "Click"),
    ("soft-pop", "Soft pop"),
    ("chime", "Chime"),
    ("ping", "Ping"),
    ("classic", "Classic"),
];

pub fn is_shutter_sound(id: &str) -> bool {
    SHUTTER_SOUNDS.iter().any(|(known, _)| *known == id)
}

/// The WAV bytes for a sound id (unknown ids fall back to the default click). Every
/// clip opens with ~70 ms of silence so Windows' cold-endpoint fade-in never eats it.
fn shutter_bytes(id: &str) -> &'static [u8] {
    static CLASSIC: OnceLock<Vec<u8>> = OnceLock::new();
    match id {
        "soft-pop" => include_bytes!("sounds/soft-pop.wav"),
        "chime" => include_bytes!("sounds/chime.wav"),
        "ping" => include_bytes!("sounds/ping.wav"),
        "classic" => CLASSIC.get_or_init(shutter_wav),
        _ => include_bytes!("sounds/click.wav"),
    }
}

/// Preview a shutter sound from Settings (async: never holds the UI thread).
#[tauri::command(async)]
pub fn sound_preview(id: String) -> Result<(), String> {
    if !is_shutter_sound(&id) {
        return Err("Unknown shutter sound".into());
    }
    play_shutter(&id);
    Ok(())
}

/// Open the output device ahead of a likely sound (Settings opened, capture started).
#[tauri::command(async)]
pub fn sound_warm() {
    warm();
}

enum Command {
    Warm,
    Play(&'static [u8]),
}

/// One audio thread owns a persistent output stream. Win32 PlaySound reopened the
/// device on every call — up to a second of latency on some drivers (Bluetooth
/// especially). The stream opens on warm-up or first play and closes after
/// `IDLE` without sounds, so Glint never holds the device open indefinitely.
fn audio() -> &'static std::sync::mpsc::Sender<Command> {
    const IDLE: std::time::Duration = std::time::Duration::from_secs(15);
    static SENDER: OnceLock<std::sync::mpsc::Sender<Command>> = OnceLock::new();
    SENDER.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<Command>();
        let _ = std::thread::Builder::new().name("glint-audio".into()).spawn(move || {
            let mut output: Option<(rodio::OutputStream, rodio::OutputStreamHandle)> = None;
            loop {
                let command = if output.is_some() {
                    match rx.recv_timeout(IDLE) {
                        Ok(command) => command,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            output = None; // release the device while idle
                            continue;
                        }
                        Err(_) => return,
                    }
                } else {
                    match rx.recv() {
                        Ok(command) => command,
                        Err(_) => return,
                    }
                };
                if output.is_none() {
                    output = rodio::OutputStream::try_default().ok();
                }
                if let (Command::Play(bytes), Some((_, handle))) = (command, output.as_ref()) {
                    play_on(handle, bytes);
                }
            }
        });
        tx
    })
}

fn play_on(handle: &rodio::OutputStreamHandle, bytes: &'static [u8]) {
    use rodio::Source;
    match rodio::Decoder::new_wav(std::io::Cursor::new(bytes)) {
        // The clips open with ~70 ms of silence meant for PlaySound's cold device;
        // the stream here is already open, so start at the sound itself.
        Ok(source) => {
            let _ = handle.play_raw(source.skip_duration(std::time::Duration::from_millis(60)).convert_samples());
        }
        Err(error) => log::warn!("shutter sound could not be decoded: {error}"),
    }
}

pub fn warm() {
    let _ = audio().send(Command::Warm);
}

/// Play a shutter sound on the persistent stream; falls back to PlaySound if the
/// audio thread is unavailable.
pub fn play_shutter(id: &str) {
    let wav = shutter_bytes(id);
    if audio().send(Command::Play(wav)).is_ok() {
        return;
    }
    #[cfg(windows)]
    unsafe {
        use windows::core::PCWSTR;
        use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY};
        let _ = PlaySoundW(PCWSTR(wav.as_ptr() as *const u16), None, SND_MEMORY | SND_ASYNC);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_selectable_sound_is_a_pcm_wav() {
        for (id, _) in SHUTTER_SOUNDS {
            let wav = shutter_bytes(id);
            assert_eq!(&wav[0..4], b"RIFF", "{id}");
            assert_eq!(&wav[8..12], b"WAVE", "{id}");
            assert!(wav.len() > 1_000, "{id}");
        }
        assert!(!is_shutter_sound("nope"));
    }

    #[test]
    fn shutter_wav_has_valid_riff_header() {
        let wav = shutter_wav();
        assert!(wav.len() > 44);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
    }

    #[test]
    fn starts_with_lead_in_silence() {
        // The clip must open with silence so Windows' cold-endpoint fade-in ramps up during
        // the silence, not over the shutter transient (otherwise the FIRST play per audio-
        // idle period sounds attenuated). Assert the first 30 ms of PCM are zero.
        let wav = shutter_wav();
        let start = 44; // after the WAV header
        let silent_samples = 44_100 * 30 / 1000; // 30 ms
        for i in 0..silent_samples {
            let s = i16::from_le_bytes([wav[start + i * 2], wav[start + i * 2 + 1]]);
            assert_eq!(s, 0, "sample {i} within the lead-in should be silent");
        }
    }
}
