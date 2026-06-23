//! The `.glint` document format: a versioned, self-contained JSON file holding
//! the embedded base image plus an OPAQUE `doc` (the frontend's annotations +
//! crop + frame). Rust never parses `doc` — it round-trips it as a JSON value.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Current `.glint` format version. Bump only on a breaking change.
pub const GLINT_VERSION: u64 = 1;

#[derive(Serialize, Deserialize)]
struct GlintImage {
    mime: String,
    width: u32,
    height: u32,
    #[serde(rename = "dataBase64")]
    data_base64: String,
}

#[derive(Serialize, Deserialize)]
struct GlintFile {
    glint: u64,
    app: String,
    image: GlintImage,
    doc: Value,
}

/// Parsed `.glint`: decoded image bytes + the opaque doc value.
pub struct ParsedGlint {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub doc: Value,
}

/// Build the `.glint` JSON text from raw PNG bytes + the opaque doc.
pub fn assemble(
    png: &[u8],
    width: u32,
    height: u32,
    doc: Value,
    app_version: &str,
) -> Result<String, String> {
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(png);
    let file = GlintFile {
        glint: GLINT_VERSION,
        app: app_version.to_string(),
        image: GlintImage { mime: "image/png".into(), width, height, data_base64 },
        doc,
    };
    serde_json::to_string(&file).map_err(|e| e.to_string())
}

/// Parse `.glint` JSON text → image bytes + opaque doc. Rejects unknown versions
/// and malformed input with a user-facing message.
pub fn parse(text: &str) -> Result<ParsedGlint, String> {
    let file: GlintFile = serde_json::from_str(text)
        .map_err(|_| "Couldn't open this project — the file is not a valid Glint project.".to_string())?;
    if file.glint > GLINT_VERSION {
        return Err("This project was made with a newer version of Glint.".to_string());
    }
    let png = base64::engine::general_purpose::STANDARD
        .decode(file.image.data_base64.as_bytes())
        .map_err(|_| "Couldn't open this project — the embedded image is corrupt.".to_string())?;
    Ok(ParsedGlint { png, width: file.image.width, height: file.image.height, doc: file.doc })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_image_and_doc() {
        let png = vec![1u8, 2, 3, 4, 5];
        let doc = json!({ "annotations": [{ "id": "a1" }], "crop": null, "frame": { "enabled": true } });
        let text = assemble(&png, 320, 240, doc.clone(), "0.1.0").unwrap();
        let parsed = parse(&text).unwrap();
        assert_eq!(parsed.png, png);
        assert_eq!(parsed.width, 320);
        assert_eq!(parsed.height, 240);
        assert_eq!(parsed.doc, doc); // opaque value preserved verbatim
    }

    #[test]
    fn rejects_newer_version() {
        let text = r#"{"glint":2,"app":"x","image":{"mime":"image/png","width":1,"height":1,"dataBase64":"AAEC"},"doc":{}}"#;
        assert!(parse(text).is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse("not json at all").is_err());
    }

    #[test]
    fn rejects_bad_base64() {
        let text = r#"{"glint":1,"app":"x","image":{"mime":"image/png","width":1,"height":1,"dataBase64":"!!!notbase64!!!"},"doc":{}}"#;
        assert!(parse(text).is_err());
    }
}
