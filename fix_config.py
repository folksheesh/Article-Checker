#!/usr/bin/env python3
"""Script to fix GitHub push protection by removing all API keys from config.ts"""

import os

# Take a backup of the original file
config_path = "src/sop/config.ts"
backup_path = "src/sop/config.ts.backup"

with open(config_path, 'r') as f:
    original_content = f.read()

with open(backup_path, 'w') as f:
    f.write(original_content)

# Read and modify the config file
with open(config_path, 'r') as f:
    content = f.read()

# Remove ALL API keys that exist anywhere in the file - comprehensive pattern
patterns_to_remove = [
    # Patterns to remove API key assignments
    r'import\.meta\.env(?:\.DEV)?\?\.?VITE_\w+\s*(?:\?\?[\s\S]*?\s*)?\s*;\s*\n',
    # Also capture surrounding context for more precise removal
    r'\/\*\*[^*]*?API key\s*\*\*\/\s*\n\s*export const \w+ = import\.meta\.env(?:\.DEV)?\?\.?VITE_\w+\s*(?:\?\?[\s\S]*?\s*)?\s*;\s*\n',
]

# Process content to remove API key lines and their comments
lines = content.split('\n')
processed_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Check if this line is an API key export
    is_api_key_line = False
    for pattern in patterns_to_remove:
        if re.search(pattern, line + (lines[i+1] if i+1 < len(lines) else '')):
            is_api_key_line = True
            break
    
    # Skip API key lines and the comment line before them (if it's a comment)
    if not is_api_key_line:
        # Check if previous line is a comment (try to preserve other code)
        prev_line = lines[i-1] if i > 0 else ""
        is_comment_line = ('/**' in prev_line and 'API key' in prev_line)
        if not is_comment_line:
            processed_lines.append(line)
        i += 1
    else:
        # Skip this line and next line (comment + api key)
        i += 2

# Build cleaned content
cleaned_content = '\n'.join(processed_lines)

# Write cleaned content back
with open(config_path, 'w') as f:
    f.write(cleaned_content)

print(f"Removed all API key exports from config.ts")