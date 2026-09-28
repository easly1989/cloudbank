# CloudBank guides

## Start here

- [Getting started](getting-started.md): from a fresh install to your first
  transactions. The administrator, a wallet, accounts, categories, the entry
  sheet and reconciling.
- [Migrating from HomeBank](migrate-from-homebank.md): bring a HomeBank `.xhb`
  file across in one upload, and go back whenever you like.

## Using CloudBank

- [Using CloudBank, page by page](pages.md): what each page is for and what it
  can do.
- [Importing transactions](import.md): bank CSV, QIF, OFX and CAMT.053 files. The
  column mapping, the review, and what to do when rows come in wrong.
- [Automatic bank sync](bank-sync.md): connecting a bank through SimpleFIN,
  Enable Banking or Pluggy.

## Running CloudBank

- [Backups, upgrades and restoring](backup.md): what each backup holds, a
  routine that works, upgrading, and getting it all back.
- [Reverse proxy and HTTPS](reverse-proxy.md): putting CloudBank behind Caddy
  or nginx.
- [Configuration](../README.md#configuration): every `CB_*` setting.
- [Container images](../README.md#container-images-and-tag-convention): which
  tag is stable and which is the nightly.
- [The live demo](demo.md): what it is, what it switches off, and when it
  forgets you.

## Extending CloudBank

- [Writing a bank import plugin](import-plugins.md): teach the importer a bank's
  own file format.
- **The API:** every running CloudBank serves its interactive reference at
  `/api/docs`.
- [Contributing](../CONTRIBUTING.md): running from source, and how changes are
  made.

Something missing or wrong? [Open an issue](https://github.com/easly1989/cloudbank/issues/new).
