# Universal Compact Gate Outpass Form with Native Dropdowns & Quick Chips

* **Author:** safmuzammil
* **Date:** 2026-11-11

## Overview

The Gate Outpass creation interface in `OutpassTeacherDesk.jsx` previously rendered Leave Categories (11 buttons), Destinations (11 buttons), Reasons (10 buttons), and Date/Duration Shortcuts (6 buttons) as sprawling multi-row button grids. On mobile screens (375px–412px viewport width), these 38 buttons generated over 1,400px of cumulative vertical scrolling, burying time schedules, student summaries, and submit controls far below the viewport fold.

This design streamlines the form into a clean, mobile-first, universal layout:
1. **Universal Compact Dropdowns (`<select>`)**: Category, Destination, and Reason are rendered as standard native `<select>` dropdowns with `✍️ Custom ...` at index 0.
2. **Top Shortcut Chips (2–3 items)**: Fast-lane pills for high-frequency selections (e.g. `🏠 Monthly Home`, `📍 Chemmad`, `📝 Medical Case`).
3. **Removal of Redundant Duration Chips**: Purges the 5 fixed duration buttons above the date picker (`+1 Hr`, `+2 Hrs`, `Today 6:00 PM`, `+1 Day`, `+3 Days`) to eliminate visual clutter.
4. **Flexible Open-Ended Return Control**: Provides a dedicated, clean toggle for **`🏥 Open-Ended Return (No fixed deadline)`**. For medical cases, teachers can easily select this option or toggle it off if a specific return time (e.g., a 2-hour hospital checkup) is preferred.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Convert Leave Category, Destination, and Purpose/Reason into native `<select>` dropdowns with `✍️ Custom ...` at Index 0.
  * Render 2–3 high-frequency shortcut chips directly alongside each dropdown for 1-tap operation.
  * Render an autofocus text input immediately below the dropdown when `Custom` is selected.
  * Remove the 5 fixed duration preset chips (`+1 Hr`, `+2 Hrs`, `Today 6:00 PM`, `+1 Day`, `+3 Days`) from Section 5.
  * Retain a clean, dedicated toggle for `🏥 Open-Ended Return` allowing teachers to choose whether a medical (or special) leave has a fixed return deadline or is open-ended.
  * Apply this streamlined layout universally across mobile and desktop.

* **Out-of-Scope Non-Goals:**
  * Modifying the Firestore schema for `out_passes`.
  * Changing gate security scanner logic or barcode verification.
  * Changing student group selection or bulk-action mechanics.

## Technical Architecture & Component Specifications

### 1. Form Section Layout Pattern
Each of the three core fields (Category, Destination, Reason) follows an identical 3-tier component pattern:

```
[ Section Header & Validation Status Badge (Single line) ]
[ Native <select> Dropdown (Option 0: "✍️ Custom ...") ]
[ If Custom: Inline Text Input (autofocus, required) ]
[ Quick Shortcut Chips (2–3 top items for 1-tap entry) ]
```

### 2. Section 5 (Permitted Date & Time Schedule) Simplification
* **Purge Duration Chips**: Remove `+1 Hr`, `+2 Hrs`, `Today 6:00 PM`, `+1 Day`, and `+3 Days` buttons entirely.
* **Flexible Open Return Toggle**:
  * Render a clean, dedicated switch/button above the return deadline:
    `[ 🏥 Open-Ended Return (Medical / Hospital) ]`
  * When category `Medical` is selected, `isOpenReturn` can default to active, but teachers retain full control to turn it off and set an exact return time (e.g. 2 hours later).
  * When `isOpenReturn === true`:
    - Hides the `To Date & Time` return deadline picker.
    - Displays an active green confirmation pill: `✓ Open-Ended Return: Student can return at any time without a fixed deadline`.
  * When `isOpenReturn === false`:
    - Displays the standard `To Date & Time` picker.

### 3. State & Preset Synchronization
* Tapping a shortcut chip (e.g., `📍 Chemmad`) immediately sets form state and synchronizes the `<select>` value to `Chemmad`.
* If a custom value is typed, the dropdown reflects `CUSTOM` and the custom input retains focus.
* `Monthly_Home` continues to automatically set destination to "Home", purpose to "Monthly 3-Day Home Leave", and opens the 1–7 day duration selector.

## Alternatives Weighed

* *Forced Automatic Open-Return with No Toggle*: Rejected per user clarification; teachers need the flexibility to set a specific return deadline even for hospital/clinic visits when appropriate.
* *Retaining all 6 duration preset buttons*: Rejected; removing the 5 fixed duration chips saves ~100px of vertical space while keeping the essential Open-Return toggle.

## Key Decisions & Staging for Next Steps

* **Category Shortcuts**: `🏠 Monthly Home`, `☀️ Evening`, `🕌 Friday`
* **Destination Shortcuts**: `📍 Home`, `📍 Chemmad`, `📍 Bookplus`
* **Purpose Shortcuts**: `📝 Monthly 3-Day Home Leave`, `📝 Medical / Hospital Case`, `📝 Personal Purchase`
* **Schedule Section**: Fixed duration chips purged; dedicated, teacher-selectable `Open-Ended Return` toggle preserved.
* **Layout Scope**: Universal across all screen sizes.
