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