//! A short camera-shutter click, synthesized as an in-memory PCM WAV (no shipped asset) and
//! played asynchronously via Win32 PlaySound. Fully local.

use std::sync::OnceLock;

/// Little-endian PCM16 mono WAV of a refined two-stage camera snap (~140 ms): a mirror-up
/// click, a shutter click ~45 ms later, over a short low-frequency body. Deterministic.
pub fn shutter_wav() -> Vec<u8> {
    let sample_rate: u32 = 44_100;
    let n = (sample_rate as f32 * 0.14) as usize;
    let mut samples: Vec<i16> = Vec::with_capacity(n);
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

/// Play the shutter click asynchronously. The WAV bytes live in a process-lifetime static so
/// they stay valid during SND_ASYNC | SND_MEMORY playback.
pub fn play_shutter() {
    static SHUTTER: OnceLock<Vec<u8>> = OnceLock::new();
    let wav = SHUTTER.get_or_init(shutter_wav);
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
    fn shutter_wav_has_valid_riff_header() {
        let wav = shutter_wav();
        assert!(wav.len() > 44);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
    }
}
