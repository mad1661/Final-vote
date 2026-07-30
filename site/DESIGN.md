# Design System Document: The Apex Hub

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"Kinetic Precision."** 

This isn't a standard management portal; it is a high-performance telemetry environment designed for the NHRA Division Office. To break the "template" look, we move away from symmetrical, centered grids toward an **editorial, asymmetric layout** that mimics the lean and aggressive stance of a dragster. 

We utilize massive typography scales, overlapping containers, and intentional "dark space" to create a sense of exclusivity. By layering semi-transparent technical textures over a near-black foundation, we evoke the feeling of carbon fiber and asphalt under stadium lights. Every pixel must feel engineered, not just placed.

---

### 2. Colors & Surface Philosophy
The palette is rooted in high-contrast "After Dark" aesthetics. The primary `racing-red` is a tool for redirection, used sparingly but with high impact.

*   **Primary (`#ffb4ab` / `#dc2626`):** Reserved for critical actions and "Active" states.
*   **Background (`#131317`):** The foundational "tarmac" of the application.
*   **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. Structural boundaries must be defined solely through background color shifts. For example, a `surface-container-low` section should sit against the `surface` background to create a visual break without "boxing in" the content.
*   **Surface Hierarchy & Nesting:** Treat the UI as a physical stack of technical materials. 
    *   **Base:** `surface-dim` (#131317)
    *   **Sections:** `surface-container-low` (#1b1b1f)
    *   **Floating Cards:** `surface-container-highest` (#353438) at 80% opacity with a `backdrop-blur`.
*   **The "Glass & Gradient" Rule:** Use glassmorphism for floating overlays. Use a linear gradient transition from `primary-container` (#dc2626) to `primary` (#ffb4ab) on interactive highlights to simulate the "heat" of an engine.

---

### 3. Typography
The typography strategy pairs technical precision with aggressive editorial scale.

*   **Display & Headlines (Space Grotesk):** These are our "speed" elements. `display-lg` (3.5rem) should be used with `letter-spacing: 0.05em` and `text-transform: uppercase` to evoke the high-octane branding of professional racing.
*   **Body & Titles (Inter):** Used for data density and readability. Inter provides a clean, neutral balance to the aggressive headlines.
*   **The Hierarchy of Speed:** Large headlines should often bleed off-center or overlap with `surface-container` edges to break the rigid "web box" feel, creating a sense of forward motion.

---

### 4. Elevation & Depth
In this system, depth is achieved through **Tonal Layering** and light physics, not drop-shadows.

*   **The Layering Principle:** Stacking `surface-container` tiers creates a natural lift. A card using `surface-container-highest` placed on a `surface-container-low` background provides enough contrast to signify hierarchy without artificial styling.
*   **Ambient Shadows:** Where floating is required (e.g., Modals), use a "Neon Glow" shadow. Instead of a grey shadow, use a 4% opacity `primary` (#ffb4ab) shadow with a 32px blur to simulate the glow of brake lights on the track.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility, use the `outline-variant` token at 15% opacity. It should be felt, not seen.
*   **Glassmorphism:** Navigation sidebars and sticky headers must use `surface-container` colors with a 12px `backdrop-filter: blur()`. This allows the content moving behind it to provide a sense of speed and continuity.

---

### 5. Components

**Buttons**
*   **Primary:** Solid `primary-container` (#dc2626). On hover, apply a `box-shadow` of 0 0 20px `primary-fixed-dim` to create a "redline" glow.
*   **Secondary:** Ghost style with a `Ghost Border` and `on-surface` text. Hover state shifts the background to `surface-bright` (#39393d).

**Interactive Cards**
*   No borders. Use `surface-container-high` as the base. 
*   Incorporate a 4px vertical accent line of `primary` (#ffb4ab) on the left edge only to denote "High Priority" items.

**Form Elements**
*   **Inputs:** Use `surface-container-lowest` for the field background. 
*   **Security Pattern:** In empty states or headers, use a "Security Dot" pattern (1px dots spaced 12px apart) in `outline-variant` to add a technical, blueprint-like texture.

**Sidebar Navigation**
*   Minimalist icons only. The active state is indicated by a `primary` neon glow behind the icon, rather than a bulky background fill.
*   Sticky positioning with a subtle `backdrop-blur` of 20px.

**Lists**
*   **No Dividers:** Separate list items using the spacing scale (e.g., `spacing-4`). 
*   **Hover State:** A list item should shift from `surface` to `surface-container-low` on hover to provide a "soft lift" interaction.

---

### 6. Do’s and Don’ts

**Do:**
*   **Do** use extreme white space (`spacing-16` or `spacing-24`) to separate major content blocks.
*   **Do** lean into asymmetry. It’s okay if a header is left-aligned and the body content is slightly offset.
*   **Do** use "Carbon Fiber" textures (subtle diagonal patterns) in the `surface-dim` background for high-end hero sections.

**Don’t:**
*   **Don't** use 100% white (#ffffff). Use `on-surface` (#e5e1e6) for a more sophisticated, "brushed metal" look.
*   **Don't** use standard "Material" rounded corners. Stick to the `md` (0.375rem) or `sm` (0.125rem) scale for a sharper, technical feel. `full` is for chips only.
*   **Don't** use traditional "Drop Shadows" (Black, 20% opacity). They muddy the dark-mode aesthetic. Use tonal shifts or colored glows.

---

### Director's Final Note
Every element in this system should feel like it belongs on a $100,000 piece of racing machinery. If a component feels "default," it’s wrong. Increase the contrast, tighten the radii, and let the typography do the heavy lifting.