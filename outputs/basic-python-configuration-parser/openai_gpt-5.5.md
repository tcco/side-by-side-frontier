```python
def parse_config(config_string: str) -> dict:
    """
    Parse a multiline configuration string containing key=value pairs.

    Rules:
    - Empty lines are ignored.
    - Lines starting with #, after leading whitespace is stripped, are ignored.
    - Keys and values have leading/trailing whitespace removed.
    - Only the first '=' separates the key from the value.
    """
    config = {}

    for line in config_string.splitlines():
        stripped_line = line.strip()

        if not stripped_line:
            continue

        if stripped_line.startswith("#"):
            continue

        if "=" not in line:
            raise ValueError(f"Invalid config line: {line}")

        key, value = line.split("=", 1)
        config[key.strip()] = value.strip()

    return config
```

Example usage:

```python
config_text = """
# Database settings
host = localhost
port = 5432

username = admin
password = secret=with=equals
"""

result = parse_config(config_text)

print(result)
```

Output:

```python
{
    "host": "localhost",
    "port": "5432",
    "username": "admin",
    "password": "secret=with=equals"
}
```