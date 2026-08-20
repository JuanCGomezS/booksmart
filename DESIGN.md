---
name: BookSmart
description: Editioned Service Press — a precise appointment platform with the energy of a limited-run print studio.
colors:
  ink: '#101114'
  paper: '#F1EEE6'
  paper-deep: '#D8D3C8'
  silver: '#B9BDC4'
  pink: '#F13B87'
  marigold: '#FFB400'
  signal-green: '#1E9A62'
  signal-red: '#C93542'
  ink-soft: '#1C1D21'
  warning-text: '#7A4B00'
  warning-bg: '#FFE3A3'
  warning-border: '#B87D00'
  success-text: '#075C3A'
  success-bg: '#C9F1DC'
  danger-text: '#861C28'
  danger-bg: '#FFD9DC'
typography:
  display:
    fontFamily: 'Oswald, sans-serif'
    fontSize: 'clamp(3rem, 8vw, 6rem)'
    fontWeight: 700
    lineHeight: 0.86
    letterSpacing: '-0.045em'
  body:
    fontFamily: 'Archivo, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'Archivo, sans-serif'
    fontSize: '0.72rem'
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: '0.12em'
rounded:
  control: '2px'
  panel: '4px'
spacing:
  unit: '8px'
  section: '96px'
components:
  button-primary:
    backgroundColor: '{colors.pink}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '14px 20px'
  button-secondary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: '14px 20px'
  field:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '10px 12px'
---

# Design System: BookSmart

## Overview

**Creative North Star: "Editioned Service Press"**

BookSmart treats a booking system like a limited-run service bulletin: ink-black fields, utilitarian silver rules, fluorescent pink actions, and marigold registration marks. Marketing is loud enough to make the operating system memorable; booking and administration use the same materials with a calmer, task-first density.

The interface is printed, not nostalgic. Halftone texture, offset registration ticks, and compact production labels carry identity while native controls, plain language, and clear state colors keep appointments easy to operate.

**Key Characteristics:**

- Ink-black base with paper surfaces and fluorescent operational signals.
- Condensed display type only for statements; workhorse sans serif for tasks.
- Square-edged panels, thin rules, and print-registration state markers.

## Colors

The palette behaves like a two-ink press: paper and ink do the work; pink and marigold communicate intention and focus.

### Primary

- **Fluorescent Action Pink:** Primary actions, selected booking choices, and active navigation.

### Secondary

- **Registration Marigold:** Attention, pending labels, and measured emphasis.
- **Foil Silver:** Borders, metadata, and quiet structural surfaces.

### Tertiary

- **Signal Green:** Completed or confirmed appointment states.
- **Signal Red:** Errors, destructive actions, and unavailable states.

### Neutral

- **Press Ink:** Application ground and strongest text.
- **Uncoated Paper:** Default reading and form surface.
- **Paper Shadow:** Inset divisions and disabled areas.

### Named Rules

**The Two-Ink Rule.** One task state gets one signal color; pink is never used merely as decoration inside operational screens.

## Typography

**Display Font:** Oswald (with sans-serif fallback)
**Body Font:** Archivo (with sans-serif fallback)
**Label/Mono Font:** Archivo (with sans-serif fallback)

**Character:** Big condensed declarations give the marketing surface its poster voice. Operational text remains conventional, sturdy, and immediately scannable.

### Hierarchy

- **Display** (900, `clamp(3rem, 8vw, 6rem)`, 0.86): Landing statements only.
- **Headline** (800, `clamp(1.8rem, 4vw, 3.25rem)`, 0.95): Section and application titles.
- **Title** (800, 1.25rem, 1.1): Panels and task headings.
- **Body** (400, 1rem, 1.55): Explanations, kept near 65ch.
- **Label** (800, 0.72rem, 1.2): Compact metadata and print-style tags.

## Layout

Marketing uses a broad press-sheet grid with asymmetric capability frames and generous editorial gaps. Booking and administration constrain work to readable columns, preserve native-sized targets, and collapse to one column under 720px. Section rhythm is 96px on large screens and 64px on small screens.

## Elevation & Depth

Depth is physical: a dark offset shadow sits beneath paper panels. No glow or glass is used. Halftone is a low-contrast background material, never a text treatment.

### Shadow Vocabulary

- **Press Lift** (`8px 8px 0 #101114`): Primary buttons and selected panels.
- **Quiet Lift** (`4px 4px 0 rgba(16,17,20,.22)`): Standard cards and menus.

## Shapes

Controls are deliberately near-square (`2px`); panels receive only a small softening (`4px`). Borders are thin, direct, and often paired with a registration corner rather than oversized colored rails.

## Components

### Buttons

- **Shape:** Press-cut corners (2px).
- **Primary:** Fluorescent pink, ink text, black offset shadow.
- **Hover / Focus:** Lift resolves toward the pointer; focus gets a marigold outer ring.
- **Secondary / Ghost:** Ink fill or paper with an ink rule; no washed-out outline-only primary action.

### Cards / Containers

- **Corner Style:** Nearly square (4px).
- **Background:** Paper or ink according to surface mode.
- **Shadow Strategy:** Offset only; selected surfaces use a stronger press lift.
- **Border:** 1px foil or ink rule.

### Inputs / Fields

- **Style:** Paper fill, ink border, 2px radius.
- **Focus:** Pink border plus marigold focus ring.
- **Error / Disabled:** Signal red message treatment; paper-shadow disabled state.

### Navigation

- **Style:** Compact labels, explicit selected state, horizontal scroll rather than hidden controls on narrow screens.

## Do's and Don'ts

### Do:

- **Do** use registration ticks and halftone only to frame or identify a real state.
- **Do** keep booking and administrative task text at normal reading sizes.
- **Do** preserve visible keyboard focus and native date, time, checkbox, and select affordances.

### Don't:

- **Don't** use decorative gradients, glass, or neon glows.
- **Don't** turn appointment status into a decorative badge collection; state color must remain explicit in text.
- **Don't** use display lettering for form labels, table data, or error recovery.
