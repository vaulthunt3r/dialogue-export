# Privacy Policy

Last updated: October 24, 2026

Dialogue Export does not collect or transmit user data.

Conversation content is read only after the user starts an export. Processing occurs locally inside Firefox, and the resulting file is saved directly through Firefox's download or print interface.

The extension does not include analytics, telemetry, advertising, tracking, remote scripts, user accounts, or external servers. Local extension storage is used only for interface preferences such as export options.

Dialogue Export requests access only to `https://chatgpt.com/*` and `https://gemini.google.com/*` so it can read the open conversation selected by the user.

When **Include message timestamps** is enabled for ChatGPT, the extension reads message IDs and creation times from metadata already present on the conversation page. This information is used only to produce the requested local export. The extension makes no additional network requests for timestamps. The preference is stored locally, and timestamp data is kept in memory during collection.

During HTML/PDF export, existing lazy images in mounted messages may temporarily be set to load eagerly so Firefox can finish loading them before capture. These are the image URLs already used by the conversation page; the extension does not upload the content or use a separate media-fetching service. Images that cannot be embedded may retain an external reference with a notice, so opening that export can request the image from its original host. Embedded images are self-contained.
