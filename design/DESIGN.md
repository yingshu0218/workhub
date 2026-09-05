---
name: Synchronous Workspace
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  button:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  container-margin-mobile: 16px
  container-margin-desktop: 40px
  gutter: 16px
---

## Brand & Style

The design system is engineered for small, high-velocity teams requiring a focused and collaborative environment. The brand personality is dependable, efficient, and transparent. It avoids unnecessary visual noise to prioritize task completion and clarity of data.

The aesthetic follows a **Modern Minimalist** approach. It utilizes generous whitespace to reduce cognitive load and employs a systematic hierarchy to distinguish between navigation, content, and action. The interface should feel like a high-performance tool: precise, responsive, and unobtrusive.

## Colors

This design system utilizes a functional palette where color communicates intent and status:

- **Primary (Team Blue):** Used for primary actions, active states, and brand presence. It signifies reliability and progress.
- **Success (Green):** Specifically reserved for financial data, positive growth metrics, and "complete" states.
- **Neutral (Slate/Grey):** Used for structural elements, borders, and secondary text. The background is a cool off-white to reduce screen glare during long work sessions.
- **Surface:** Pure white is used for cards and containers to pop against the subtle grey background, creating a clear "layered" effect.

## Typography

The typography system is built entirely on **Inter** to leverage its exceptional legibility in digital interfaces and its neutral, professional tone. 

- **Hierarchy:** Use `headline-lg` for primary page titles. On mobile, swap to `headline-lg-mobile` to maintain balanced proportions.
- **Readability:** All body text should use a minimum of 14px to ensure accessibility.
- **Utility:** `label-caps` is used for category tags, table headers, and small metadata to provide visual distinction without increasing font size.

## Layout & Spacing

This design system uses a **mobile-first fluid grid**. 

- **Mobile (0-767px):** Single column layout with 16px side margins. Elements stack vertically.
- **Tablet/Desktop (768px+):** Transition to a 12-column grid. Max content width is 1200px.
- **Rhythm:** All spacing is based on a 4px baseline. Use `16px (md)` for standard gutters and internal card padding. Use `24px (lg)` or `32px (xl)` to separate distinct logical sections.

## Elevation & Depth

Hierarchy is established through **Tonal Layers** and **Ambient Shadows**:

- **Level 0 (Background):** Used for the main canvas behind all content (#F8FAFC).
- **Level 1 (Card/Surface):** White surfaces (#FFFFFF) with a very soft, diffused shadow (0px 1px 3px rgba(0,0,0,0.05)) and a 1px border (#E2E8F0).
- **Level 2 (Interactive/Floating):** For dropdowns and modals, use a more pronounced shadow (0px 10px 15px -3px rgba(0,0,0,0.1)) to indicate they are closer to the user.
- **Interactive State:** Hovering over a Level 1 card should subtly increase the shadow depth to provide tactile feedback.

## Shapes

The design system uses **Soft** roundedness to strike a balance between professional precision and modern approachability.

- **Standard (4px):** Used for input fields, checkboxes, and small buttons.
- **Large (8px):** Used for cards, containers, and main action buttons.
- **Extra Large (12px):** Reserved for large featured sections or onboarding modals.
- **Full (Pill):** Used exclusively for status chips (e.g., "Active", "Pending") and user avatars.

## Components

- **Buttons:** Primary buttons use the Team Blue background with white text. Secondary buttons use a ghost style (transparent background, Team Blue border).
- **Cards:** White background, 1px border (#E2E8F0), and 8px corner radius. Keep padding consistent at 16px or 24px.
- **Input Fields:** Use a 1px neutral border. On focus, the border transitions to Team Blue with a subtle outer glow.
- **Chips:** Small, pill-shaped indicators. For financial/success chips, use a light green background (#D1FAE5) with dark green text (#065F46).
- **Lists:** Use subtle horizontal dividers (1px, #F1F5F9) rather than boxed containers for long-form data to keep the interface airy.
- **Collaboration Elements:** Avatars should always be circular. "Presence" indicators (online/offline) should be 8px dots positioned at the bottom right of the avatar.