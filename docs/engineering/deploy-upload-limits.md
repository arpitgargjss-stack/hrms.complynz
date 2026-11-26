# Upload size limits (server and proxy)

Uploads are sent as base64 inside JSON, which is about 4/3 the size of the original file.

| Layer | Limit | Where |
| --- | --- | --- |
| Candidate onboarding submit (all documents in one request) | 25 MB body | `server/index.ts`, `/api/public/onboarding` |
| Every other API request | 12 MB body | `server/index.ts` |
| Any single stored file | 10 MB | `server/lib/files.ts` |
| Onboarding page, before sending | 10 MB per file, 17 MB total; photos resized to 2000px JPEG | `client/src/pages/Onboarding.tsx` |

## nginx on the server

nginx is not configured in this repo. Its default `client_max_body_size` is **1 MB**, which rejects almost every
document upload with `413 Request Entity Too Large` before it reaches the app. In the `server { }` block for
`hrms.complynz.com` set:

```nginx
client_max_body_size 25m;
```

Then check and reload:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

If you raise the app limit in `server/index.ts`, raise this value to match.
