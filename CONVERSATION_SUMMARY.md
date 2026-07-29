# Project Status: SOP Evaluation System Overhaul

## Summary
Updated Article Checker's SOP evaluation UI to separate approval and ignore functions with precise state management. Created two-state system: 
- **Approval** = permanent pass (green)
- **Ignore** = temporary exclusion (grey)

## Key Issues Fixed

### 1. SOP Issue Categories - APPROVAL vs IGNORE
**SOP Cards:**
- **Setujui (green ✓)** → Issues marked as passed (green card, 'Need Review' category automatically moves to 'Passed')
- **Abaikan (grey X)** → Temporarily ignored (grey card with toggle)
- Only show both buttons when issue is in need of review (not auto-correctable or ignored)

**AI Cards:**
- **Setujui (green ✓)** → Issue approved but stays in AI results
- **Abaikan (grey X)** → Issue ignored completely (grayed out)

### 2. SOP State Management
**States:**
- **Passed**: Green, stable, no controls
- **Approved**: Immediately moves from 'Need Review' → 'Passed'
- **Ignored**: Grey, shows toggle to unignore
- **In Progress**: Active issue with both approve/ignore buttons

**State Transitions:**
- `Approved` toggles: Confirmed issues move from review → passed
- `Ignored` toggles: Temporarily hide issues, restores with control

### 3. Car Control Logic
**SOP (Need Review: 'info' category):**
- Button available: both approve and ignore (except when already in disabled state)
- Single source of truth: `approvedIds` or `ignoredIds`
- Rule: If approved, automatically excluded from ignore state

**AI Evaluation:**
- 'Setujui' button only appears for yellow warning items (not errors)
- Toggle properly transitions between appear/exclude states

## Technical Implementation
- `toggleCategoryApprove`: Focused on info status items with exclusive exclusivity management
- `toggleCategoryIgnore`: Complete synchronization between appstate and UI elements for both hidden states
- Responsive control system: Conditional rendering, precise state mapping

## Behavior Demonstration

1. **SOP Card:** CTA issue with 'Setujui' button → clicking turns it green, removes control, passes automatically
2. **SOP Card:** Static warning issue with 'Abaikan' only → clicking temporarily greys it out
3. **AI Card:** Yellow warning item shows both approve and ignore - interactable; error item only shows ignore button

Build passes. Test individual buttons within SOP and AI evaluation sections; confirm visual states and interactions appropriately.