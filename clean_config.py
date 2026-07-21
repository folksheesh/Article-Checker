#!/usr/bin/env python3
"""Script to clean up all API keys from src/sop/config.ts"""

import re

# Read the current config file
with open('src/sop/config.ts', 'r') as f:
    content = f.read()

# Remove all lines that contain VITE_ environment variables and API key assignments
# Pattern 1: Lines with VITE_ variables in export const assignments
content = re.sub(r'^export const \w+ = import\.meta\.env.*?(\?\?\s*[\';\'].*?,[\s\';\[)])?\s*;\s*\n', '', content, flags=re.MULTILINE)

# Pattern 2: Remove lines with simple VITE_ assignment (no fallback)
content = re.sub(r'^export const \w+ = import\.meta\.env\?\.(\s*VITE_[A-Z_]+);\s*\n', r'', content, flags=re.MULTILINE)

# Pattern 3: Remove comments with "API key" that precede API key lines
content = re.sub(r'^\s*\/\*\*[^*]*?API key\s*\*\*\/\s*\n', '', content)

# Pattern 4: Clean up blank lines that were left behind
content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)

# Remove empty lines at the end
content = content.rstrip() + '\n'

# Write the cleaned content back
with open('src/sop/config.ts', 'w') as f:
    f.write(content)

print("✓ Cleaned src/sop/config.ts")
print(f"Remaining config length: {len(content)} characters")
print("\nRemaining config preview:")
print("-" * 40)
print(content[:500] + "..." if len(content) > 500 else content)
