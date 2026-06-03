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