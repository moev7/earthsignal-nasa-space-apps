"""Opaque signed principal contract; never a filesystem path or SQL expression."""
def valid_owner(value):
    return isinstance(value,str) and 1<=len(value)<=256 and all(33<=ord(c)<=126 for c in value)
