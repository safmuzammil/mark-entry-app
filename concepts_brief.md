# Universal Compact Gate Outpass Form with Native Dropdowns & Quick Chips

* **Author:** safmuzammil
* **Date:** 2026-11-11

## Overview

The Gate Outpass creation interface in `OutpassTeacherDesk.jsx` previously rendered Leave Categories (11 buttons), Destinations (11 buttons), Reasons (10 buttons), and Date/Duration Shortcuts (6 buttons) as sprawling multi-row button grids. On mobile screens (375px–412px viewport width), these 38 buttons generated over 1,400px of cumulative vertical scrolling, burying time schedules, student summaries, and submit controls far below the viewport fold.

This design streamlines the form into a clean, mobile-first, universal layout:
1. **Universal Compact Dropdowns (`<select>`)**: Category, Destination, and Reason are rendered as standard native `<select>` dropdowns with `✍️ Custom ...` at index 0.
2. **Top Shortcut Chips (2–3 items)**: Fast-lane pills for high-frequency selections (e.g. `🏠 Monthly Home`, `📍 Chemmad`, `📝 Medical Case`).
3. **Removal of Schedule Duration Chips**: Purges the 6 duration buttons above the date picker (`+1 Hr`, `+2 Hrs`, `Today 6:00 PM`, `+1 Day`, `+3 Days`, `Open Return`) to drastically declutter the schedule section.
4. **Automatic Open-Ended Return for Medical Cases**: When the category is `Medical` or the reason is `Medical / Hospital Case`, the system automatically activates `isOpenReturn = true` (open-ended return without a fixed deadline), hiding the `To Date & Time` picker and displaying a green notice badge.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Convert Leave Category, Destination, and Purpose/Reason into native `<select>` dropdowns with `✍️ Custom ...` at Index 0.
  * Render 2–3 high-frequency shortcut chips directly alongside each dropdown for 1-tap operation.
  * Render an autofocus text input immediately below the dropdown when `Custom` is selected.
  * Completely remove the 6 redundant duration preset chips above the date picker in Section 5.
  * Automatically activate open-ended return (`isOpenReturn = true`) whenever a medical category or medical reason is selected.
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
* **Purge Duration Chips**: Remove `+1 Hr`, `+2 Hrs`, `Today 6:00 PM`, `+1 Day`, `+3 Days`, and `Open Return` buttons entirely.
* **Direct Date/Time Controls**: Users set the start date/time using the standard `CustomDateTimePicker`.
* **Automatic Open-Ended Return for Medical**:
  * If `leaveCategory === 'Medical'` or `purpose.toLowerCase().includes('medical') || purpose.toLowerCase().includes('hospital')`:
    - Automatically sets `isOpenReturn = true`.
    - Hides the `To Date & Time` return deadline picker.
    - Renders an informative badge: `🏥 Medical Exemption: Open-ended return (No fixed deadline required)`.
  * Non-medical passes display the standard `To Date & Time` picker for setting the expected return deadline.

### 3. State & Preset Synchronization
* Tapping a shortcut chip (e.g., `📍 Chemmad`) immediately sets form state and synchronizes the `<select>` value to `Chemmad`.
* If a custom value is typed, the dropdown reflects `CUSTOM` and the custom input retains focus.
* `Monthly_Home` continues to automatically set destination to "Home", purpose to "Monthly 3-Day Home Leave", and opens the 1–7 day duration selector.

## Alternatives Weighed

* *Retaining duration preset chips with smaller padding*: Rejected per user request; eliminating the 6 chips removes redundant cognitive load and saves ~120px of vertical space, as users can directly configure date/time or rely on automated presets.
* *Manual "Open Return" checkbox for medical*: Rejected in favor of automatic open-ended activation when medical reasons are selected.

## Key Decisions & Staging for Next Steps

* **Category Shortcuts**: `🏠 Monthly Home`, `☀️ Evening`, `🕌 Friday`
* **Destination Shortcuts**: `📍 Home`, `📍 Chemmad`, `📍 Bookplus`
* **Purpose Shortcuts**: `📝 Monthly 3-Day Home Leave`, `📝 Medical / Hospital Case`, `📝 Personal Purchase`
* **Schedule Section**: All top duration chips eliminated; medical cases automatically open-ended.
* **Layout Scope**: Universal across all screen sizes.
