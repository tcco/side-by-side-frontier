Here is the complete and fully functional code to solve the task, along with an explanation of how it works.

### Python Code

```python
def parse_config(config_string: str) -> dict:
    config_dict = {}
    
    # Split the multiline string into individual lines
    lines = config_string.splitlines()
    
    for line in lines:
        # Strip leading/trailing whitespace to easily check for comments and empty lines
        stripped_line = line.strip()
        
        # Ignore empty lines and lines starting with '#'
        if not stripped_line or stripped_line.startswith('#'):
            continue
            
        # Split the line at the first '=' character
        # Using maxsplit=1 ensures that if the value contains an '=', it won't be split
        parts = stripped_line.split('=', 1)
        
        # Ensure the line actually contained an '=' and was split into key and value
        if len(parts) == 2:
            key = parts[0].strip()
            value = parts[1].strip()
            config_dict[key] = value
            
    return config_dict

# ==========================================
# Example Usage:
# ==========================================
if __name__ == "__main__":
    sample_config = """
    # Database Configuration
    host = localhost
    port = 5432
    
    # API Settings
    api_key = abc123xyz
    endpoint = https://api.example.com/data?user=admin
    
      spaced_key   =   spaced_value  
    """
    
    parsed = parse_config(sample_config)
    for k, v in parsed.items():
        print(f"'{k}': '{v}'")
```

### Explanation

1. **`.splitlines()`**: This built-in string method safely splits the multiline string into a list of individual lines, handling different types of newline characters (like `\n` or `\r\n`) automatically.
2. **`.strip()` on the line**: Before processing, we strip the line of leading and trailing whitespace. This makes it easy to identify completely empty lines or lines where a comment `#` is indented.
3. **Ignoring Comments and Empty Lines**: We use a simple `if not stripped_line or stripped_line.startswith('#'): continue` to skip over the lines we don't want to process.
4. **`.split('=', 1)`**: We split the string using the equals sign. The second argument `1` is the `maxsplit` parameter. This is crucial because a configuration value might legitimately contain an equals sign (e.g., a URL like `endpoint = https://...?user=admin`). Limiting the split ensures we only separate the key from the rest of the string.
5. **`.strip()` on Keys and Values**: Finally, we strip the resulting `parts[0]` (the key) and `parts[1]` (the value) to ensure no lingering spaces are included in the final dictionary, satisfying the whitespace constraint.