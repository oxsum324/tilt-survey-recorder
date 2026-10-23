import re

def assert_cell_heading(text,expected):
    lines=[re.sub(r'\s+','',line) for line in text.splitlines() if line.strip()]
    assert lines.count('編號')==1, 'Expected exactly one cell heading'
    index=lines.index('編號')
    assert lines[index+1]==expected['label'], f"Point label must exactly equal {expected['label']}"
    assert lines[index+2]==f"測點{expected['tp']}、{expected['tb']}", 'TP/TB labels must exactly match'
