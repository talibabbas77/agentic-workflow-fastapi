# Import and export

You can bring existing documents into Lumen Notes and take your notes out at any time. This page covers supported formats, what carries over, and how to export a note, a notebook, or a whole workspace.

## Supported import formats

| Format | File extensions | What to expect |
|---|---|---|
| Markdown | .md, .markdown | Front matter tags become Lumen tags |
| Plain text | .txt | Imported as a note with no formatting |
| HTML | .html, .htm | Inline images are downloaded and attached |
| Word documents | .docx | Headings, lists, tables, and images are kept |
| CSV | .csv | Each file becomes a table note, up to 10,000 rows |
| ZIP archive | .zip | Any mix of the formats above, up to 1 GB per archive |

## Importing files

1. In the desktop or web app, select **File > Import**.
2. Choose the files or the ZIP archive you want to import.
3. Pick a destination notebook and select **Start import**.

Large imports run in the background. You can keep working, and we email you when the import is finished.

When you import a ZIP archive:

- Top-level folders become notebooks, and nested folders become subpages.
- Links between Markdown files are converted to links between Lumen notes.
- Images referenced with relative paths are imported as attachments on the right note.

The mobile apps cannot import files. Use the desktop or web app instead.

## What does not carry over

Some content cannot be represented in Lumen and is left out or changed during import:

- Comments and tracked changes in .docx files are not imported.
- Embedded video and audio become plain links.
- Macros and form fields are removed.
- Files larger than your plan's single-file limit are skipped.

Every import produces an import report that lists anything skipped or changed. You can open past reports under **Settings > Import > History**. Reports are kept for 30 days.

## Exporting a note or notebook

Open the note or notebook and select **... > Export**, then choose a format:

- **PDF**: choose A4 or Letter page size, and whether to include comments.
- **Markdown**: you get a ZIP file with one .md file per note and an `assets` folder for attachments.
- **HTML**: you get a ZIP file with one .html file per note, with images included.

Exporting a notebook includes every note and subpage in it.

Anyone with Can view access or higher can export a note. Admins can turn off exports for members and guests under **Settings > Workspace > Security > Allow exports**.

## Exporting a whole workspace

Owners and admins can export everything in a workspace at once:

1. Go to **Settings > Workspace > Export workspace**.
2. Select **Request export**.
3. When the export is ready, we email you a download link.

The export is a ZIP file containing a Markdown file for every note, all attachments, and a `workspace.json` file that describes the notebook structure, tags, comments, and sharing permissions. Version history is not included.

The download link is valid for 7 days. You can request one full workspace export every 24 hours.

## Moving notes between workspaces

To move notes from one workspace to another, for example from your personal workspace to your team workspace:

1. Select one or more notes in the sidebar. You can move up to 500 notes at a time.
2. Select **... > Move to** and choose the destination workspace and notebook.

You need Full access to the notes in the source workspace and Can edit access in the destination notebook.

Moving keeps the content and attachments, but sharing permissions are reset to match the destination notebook, and the version history of moved notes is not carried over.
