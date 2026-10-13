# Docent brand

## The name

A docent is the guide in a museum who knows the whole collection and answers
visitors' questions. Docent does the same job for a company: it learns their
documents, answers their customers, knows who is asking, and hands the
conversation to a person when it should.

## The mark

Two shapes, three ideas.

| Element | Meaning |
|---|---|
| The D | Docent. |
| The speech bubble | The conversation in the widget. The tail grows out of the stem of the D. |
| The rust bookmark | Every answer is marked to the page it came from. Citations are the product, so the ribbon sits on top of the conversation. |

In the horizontal logo the bubble body spans exactly the cap height of the
wordmark. The ribbon rises above it like an ascender and the tail drops below
the baseline like a descender, so the mark and the word share one line.

## Files

| File | Use |
|---|---|
| `docent-logo.svg` | Horizontal logo on paper or any light surface. |
| `docent-logo-reversed.svg` | Horizontal logo on ink or any dark surface. |
| `docent-mark.svg` | Mark alone on light surfaces, 32px and up. |
| `docent-mark-reversed.svg` | Mark alone on dark surfaces, 32px and up. |
| `docent-favicon.svg` | Browser tab and anything under 32px. Redrawn with a wider ribbon. Follows the OS light or dark setting. |
| `docent-app-icon.svg` | Square avatar: GitHub, social profiles, app stores. |

All files are flat vector paths. The wordmark is Newsreader SemiBold at the
72pt optical size, converted to outlines, so no font file is needed to render it.
Newsreader is by Production Type under the SIL Open Font License 1.1.

## Color

Three brand colors: paper, ink, and one rust accent. Interface tokens are tints
of those three, with a lifted rust in dark mode so it keeps its contrast.

| Token | Light | Dark | Role |
|---|---|---|---|
| `paper` | `#F5F0E6` | `#161412` | Page background. |
| `surface` | `#FBF8F2` | `#1E1B18` | Cards, panels, inputs. |
| `surface-2` | `#EFE8DC` | `#26221E` | Hover and selected rows. |
| `ink` | `#1B1916` | `#F1EBE0` | Primary text and icons. |
| `ink-muted` | `#5E574F` | `#B3AA9E` | Secondary text. |
| `ink-subtle` | `#8A8178` | `#857C71` | Placeholders and disabled text only. |
| `line` | `#DDD5C8` | `#2E2A26` | 1px borders and dividers. |
| `line-strong` | `#C9BFAF` | `#3D3833` | Input borders, emphasized dividers. |
| `rust` | `#B5431F` | `#E0673F` | The accent: primary actions, links, focus, the ribbon. |
| `rust-hover` | `#9A3818` | `#EA7C57` | Hover state of rust. |
| `rust-soft` | `#F2E1D8` | `#3A2219` | Tinted background for active nav, notices. |
| `on-rust` | `#FBF8F2` | `#161412` | Text on rust. |

Contrast (WCAG): ink on paper 15.4:1, ink-muted on paper 6.2:1, rust on paper
4.9:1, on-rust on rust 5.2:1. Dark: ink-muted on paper 8.0:1, rust on paper
5.4:1. Rust on ink is 3.2:1: fine for the ribbon and large shapes, not body text.

Status colors come from the same palette. Success is ink with a check icon.
Errors and warnings are rust with an icon and a sentence. Never rely on color
alone.

There are no other colors. No blue, green, or purple anywhere.

## Type

- Headlines: Newsreader, the same family as the wordmark.
- Body and interface: a plain grotesque. Proposal: Inter, for its tabular
  figures in the admin tables. Final choice happens in Phase 8.

## Rules

- Clear space on every side: half the cap height of the wordmark.
- Minimum size: logo 96px wide, mark 32px tall. Below 32px use the favicon file.
- Flat only. No shadows, gradients, outlines, glows, or rotation.
- Never recolor the ribbon. It is always rust.
- Never stretch, rearrange, or re-space the mark and wordmark.
- On photos or busy surfaces, place the logo on a solid paper or ink tile.
