# Processing result contract

The web interface consumes the existing asynchronous job endpoints:

1. `POST /upload` with multipart field `file` returns `{ "job_id": "..." }`.
2. `GET /status/{job_id}` returns `{ "state": "processing" | "done" | "error" }`.
3. `GET /result/{job_id}` returns the result object below once the job is done.

Transcription and translation are separate products and therefore have separate
artifacts and review states. A missing or unknown state is shown as unavailable;
the site must not infer that a result is ready.

```json
{
  "schema_version": 2,
  "document": {
    "word_count": 412,
    "source_language": "Polish",
    "reduction_percent": null,
    "kind": "other",
    "original_preview": {
      "url": "/artifact/{job_id}/original-preview.png",
      "mime_type": "image/png"
    }
  },
  "transcription": {
    "status": "needs_review",
    "preview": {
      "first_line": "Readable first line of the transcription",
      "url": "/artifact/{job_id}/transcription-preview-rest.png",
      "mime_type": "image/png"
    },
    "text": { "url": "/artifact/{job_id}/transcription.txt" },
    "document": { "url": "/artifact/{job_id}/transcription.pdf" }
  },
  "translation": {
    "status": "needs_review",
    "source_language": "Polish",
    "target_language": "English",
    "preview": {
      "first_line": "Readable first line of the translation",
      "url": "/artifact/{job_id}/translation-preview-rest.png",
      "mime_type": "image/png"
    },
    "text": { "url": "/artifact/{job_id}/translation.txt" },
    "document": { "url": "/artifact/{job_id}/translation.pdf" }
  }
}
```

Allowed `status` values are `processing`, `ready`, `needs_review`, and `error`.
The server must serve artifacts from job-scoped URLs that remain available for
the lifetime of the job. Local debug files (including `/tmp/vlm_debug`) are not
public result artifacts. `original_preview` should be a PNG render independent
of the uploaded format. `preview.url` is a fully blurred first-page image; the
web client displays `first_line` separately so only that line remains readable
in the free preview. The API must create the blur on the server before
publishing the preview URL.

The client still accepts the previous flat response (`words`, `language`,
`needs_review`, `kind`) during migration. That response cannot identify which
result a legacy `preview_url` belongs to, so the client deliberately does not
show it as either a transcription or translation preview.
