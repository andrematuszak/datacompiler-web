# Processing result contract

The site keeps one upload box visible while a job runs. When the result is ready,
the API returns the original first-page PNG, document statistics, review states,
and the type-specific translation preview.

The existing asynchronous endpoints remain:

1. `POST /upload` with multipart field `file` returns `{ "job_id": "..." }`.
2. `GET /status/{job_id}` returns `{ "state": "running" | "done" | "error" }`.
3. `GET /result/{job_id}` returns the result object once the job is done.

## Scan-only document

For pages routed as full-page scans, the right-hand panel fades between two
white-page PNGs typeset from UTF-8 text: the source-language VLM transcription
and its translation. Each PNG keeps its opening lines readable and blurs the
lower portion. Neither PNG contains the source scan. The client holds the
paywall in a fixed position over the animation.

```json
{
  "schema_version": 2,
  "document": {
    "word_count": 53,
    "source_language": "Polish",
    "reduction_percent": null,
    "kind": "handwriting",
    "mode": "scan",
    "processing_label": "Transcribed document",
    "original_preview": {
      "url": "/artifact/{job_id}/original.png",
      "mime_type": "image/png",
      "width": 900,
      "height": 1273
    }
  },
  "transcription": { "status": "needs_review" },
  "translation": {
    "status": "needs_review",
    "target_language": "English",
    "estimated_word_count": 47,
    "preview": {
      "mode": "scan_text_fade",
      "source_text_url": "/artifact/{job_id}/scan-source-text.png",
      "target_text_url": "/artifact/{job_id}/scan-translation-text.png"
    }
  }
}
```

## Native-text PDF

For native-text documents, `document.mode` is `native` and the right panel
shows a preview rendered from the translated rebuilt PDF. No text overlay or
fade is used.

```json
"translation": {
  "status": "needs_review",
  "target_language": "English",
  "preview": {
    "mode": "native_pdf",
    "url": "/artifact/{job_id}/native-translation.png",
    "mime_type": "image/png"
  }
}
```

Transcription and translation also have separate UTF-8 `.txt` and PDF artifacts.
The source text uses the VLM draft when available, and translated text comes
from XLIFF, so the preview retains characters such as Polish `ł` and `€`.
Only the site-facing outputs are published; `/tmp/vlm_debug` remains diagnostic
data. `ready`, `needs_review`, and `error` are independent states for each
result. The current server reports `needs_review` until automatic review
criteria are set. It requires `DEEPL_AUTH_KEY` to create the default
translation; on failure it returns `translation.status: "error"` and still
returns the transcription and original preview.
