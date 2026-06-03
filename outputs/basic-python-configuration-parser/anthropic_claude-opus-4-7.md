# Configuration Parser

Here's a clean implementation of the `parse_config` function that meets all the requirements:

```python
def parse_config(config_string: str) -> dict:
    """
    Parse a multiline configuration string into a dictionary.
    
    Args:
        config_string: A multiline string containing key=value pairs.
                       Lines starting with '#' are treated as comments.
                       Empty lines are ignored.
    
    Returns:
        A dictionary mapping keys to values (both stripped of whitespace).
    """
    result = {}
    
    # Split the input into individual lines
    lines = config_string.split('\n')
    
    for line in lines:
        # Strip whitespace from the entire line first
        stripped_line = line.strip()
        
        # Skip empty lines
        if not stripped_line:
            continue
        
        # Skip comment lines
        if stripped_line.startswith('#'):
            continue
        
        # Skip lines without '=' (malformed lines)
        if '=' not in stripped_line:
            continue
        
        # Split on the FIRST '=' only, in case value contains '='
        key, value = stripped_line.split('=', 1)
        
        # Strip whitespace from key and value
        key = key.strip()
        value = value.strip()
        
        # Only add if key is non-empty
        if key:
            result[key] = value
    
    return result
```

## How It Works

1. **Split into lines**: We use `str.split('\n')` to get individual lines.

2. **Strip & filter each line**:
   - `line.strip()` removes leading/trailing whitespace.
   - Empty lines are skipped via `if not stripped_line`.
   - Comment lines (starting with `#`) are skipped.
   - Malformed lines without `=` are safely skipped.

3. **Split key/value**: We use `split('=', 1)` with a `maxsplit` of 1. This ensures values containing `=` (like URLs with query strings, or base64 strings) are preserved correctly.

4. **Strip key and value**: This handles formatting like `host = localhost` cleanly.

## Example Usage

```python
config_text = """
# Database configuration
host = localhost
port=5432

# User credentials
username =   admin
password=  s3cr3t=value!

# Empty lines and comments are ignored

api_url=https://example.com/api?token=abc123
"""

parsed = parse_config(config_text)
for key, value in parsed.items():
    print(f"{key!r:15} -> {value!r}")
```

### Output

```
'host'          -> 'localhost'
'port'          -> '5432'
'username'      -> 'admin'
'password'      -> 's3cr3t=value!'
'api_url'       -> 'https://example.com/api?token=abc123'
```

## Edge Cases Handled

| Case | Behavior |
|------|----------|
| Empty string input | Returns `{}` |
| Only comments | Returns `{}` |
| Line without `=` | Skipped silently |
| Value containing `=` | Preserved fully (only first `=` is the delimiter) |
| Whitespace around `=` | Stripped from both key and value |
| Empty value (`key=`) | Allowed; stores empty string |
| Empty key (`= value`) | Skipped (no nameless entries) |
| Indented comments (`  # ...`) | Correctly treated as comments |

## Constraint Compliance

✅ **No imports used** — only built-in string methods (`split`, `strip`, `startswith`) and the `in` operator are utilized, all part of Python's core language without requiring any module imports.