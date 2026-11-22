# Picture library sources

- 510 pictures come from [Openclipart](https://openclipart.org), released under
  CC0 1.0 (public domain). No credit is required. Each one's Openclipart id is in
  `catalog.json` (`"source": "openclipart", "source_id": <id>`), so the original can be
  found at `https://openclipart.org/detail/<id>`.
- 15 pictures (apple, butterfly, cloud, door, fish, flower, party_hat, pencil, sign, star,
  window and the basic shapes) were drawn for this app and have no `source`.

How the Openclipart pictures were prepared (2026-11-15):
- Chosen by name from line-art searches, then checked by eye one by one.
- Each SVG was cleaned before it was added: only plain drawing elements are kept. Scripts,
  embedded images, outside links, `<style>` blocks, filters and editor data were removed.
- Trimmed to the drawing, and numbers shortened, to keep the files small.
- An SVG is kept only when it is 40 KB or less; larger drawings are stored as PNG only.
  Every picture has a PNG, which the Word export uses.

To add a picture: put `<name>.svg` (or `<name>.png`) here, add a `catalog.json` entry with
`en`, `ur` and `tags`, and run `python scripts/paper_pictures_to_png.py` for the PNG copy.
The picture tests check that every catalog entry has its file and that SVGs stay clean.
