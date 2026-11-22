"""Bounded declarative data operations. Never eval/exec/template source."""
import csv
import io
import json
import math
import re
import xml.etree.ElementTree as ET

MAX_BYTES = 262144
BAD_KEYS = {'__proto__', 'prototype', 'constructor'}


class WorkflowFault(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def need(value, code='INVALID_ARGUMENTS'):
    if value is not True:
        raise WorkflowFault(code)


def bounded(value):
    count = 0
    def walk(item, depth):
        nonlocal count
        count += 1
        need(count <= 15000 and depth <= 24, 'DATA_COMPLEXITY_LIMIT')
        if type(item) is dict:
            need(len(item) <= 100 and all(type(k) is str and len(k) <= 240 and k not in BAD_KEYS for k in item), 'UNSAFE_OBJECT_KEYS')
            for child in item.values(): walk(child, depth + 1)
        elif type(item) is list:
            need(len(item) <= 1000, 'ROW_LIMIT')
            for child in item: walk(child, depth + 1)
        elif type(item) is str:
            need(len(item.encode('utf-8')) <= MAX_BYTES, 'TEXT_LIMIT')
        elif type(item) in (int, float):
            need(abs(item) <= 10**15 and math.isfinite(item), 'NUMBER_LIMIT')
        else:
            need(item is None or type(item) is bool, 'JSON_VALUE_REQUIRED')
    walk(value, 0)
    need(len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()) <= MAX_BYTES,
         'OUTPUT_LIMIT')
    return value


def text(value):
    need(type(value) is str and len(value.encode()) <= MAX_BYTES, 'INPUT_LIMIT')
    return value


def field(row, name):
    need(type(name) is str and 0 < len(name) <= 160, 'FIELD_INVALID')
    parts = name.split('.')
    need(len(parts) <= 8 and all(p and p not in BAD_KEYS for p in parts), 'FIELD_INVALID')
    current = row
    for part in parts:
        if type(current) is not dict or part not in current:
            return None
        current = current[part]
    return current


def rows(value):
    bounded(value)
    need(type(value) is list and len(value) <= 1000 and all(type(r) is dict for r in value), 'OBJECT_ROWS_REQUIRED')
    return value


def parse_json(args):
    def pairs(values):
        result = {}
        for key, value in values:
            need(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    try:
        return bounded(json.loads(text(args['text']), object_pairs_hook=pairs,
                                  parse_constant=lambda _: (_ for _ in ()).throw(WorkflowFault('NONFINITE_JSON'))))
    except (ValueError, RecursionError):
        raise WorkflowFault('JSON_INVALID') from None


def stringify_json(args):
    return json.dumps(bounded(args['value']), ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(',', ':'))


def parse_csv(args):
    delimiter = args.get('delimiter', ',')
    need(delimiter in (',', ';', '\t'), 'CSV_DELIMITER_INVALID')
    try:
        reader = csv.reader(io.StringIO(text(args['text'])), delimiter=delimiter, strict=True)
        table = []
        for row in reader:
            need(len(table) < 1001 and len(row) <= 100 and all(len(v) <= 4096 for v in row), 'CSV_LIMIT')
            table.append(row)
    except csv.Error:
        raise WorkflowFault('CSV_INVALID') from None
    if not table:
        return {'fields': [], 'rows': []}
    header = table[0]
    need(len(header) == len(set(header)) and all(k and k not in BAD_KEYS for k in header), 'CSV_HEADER_INVALID')
    need(all(len(r) == len(header) for r in table[1:]), 'CSV_COLUMN_MISMATCH')
    return bounded({'fields': header, 'rows': [dict(zip(header, row)) for row in table[1:]]})


def stringify_csv(args):
    data = rows(args['rows'])
    columns = args['fields']
    need(type(columns) is list and 1 <= len(columns) <= 100 and len(set(columns)) == len(columns)
         and all(type(k) is str and 0 < len(k) <= 160 and k not in BAD_KEYS for k in columns), 'CSV_FIELDS_INVALID')
    out = io.StringIO()
    writer = csv.writer(out, lineterminator='\n')
    def cell(v):
        need(v is None or type(v) in (str, int, float, bool), 'CSV_SCALAR_REQUIRED')
        value = '' if v is None else str(v)
        # Spreadsheet formula injection protection is on for strings/headers.
        if type(v) is str and value.startswith(('=', '+', '-', '@', '\t', '\r')):
            value = "'" + value
        return value
    writer.writerow([cell(c) for c in columns])
    for row in data:
        writer.writerow([cell(field(row, c)) for c in columns])
        need(out.tell() <= MAX_BYTES, 'OUTPUT_LIMIT')
    return text(out.getvalue())


def parse_xml(args):
    raw = text(args['text'])
    need(re.search(r'<!\s*(?:DOCTYPE|ENTITY)', raw, re.I) is None, 'XML_ENTITIES_FORBIDDEN')
    try:
        root = ET.fromstring(raw)
    except (ET.ParseError, ValueError, RecursionError):
        raise WorkflowFault('XML_INVALID') from None
    count = 0
    def convert(node, depth=0):
        nonlocal count
        count += 1
        need(count <= 1000 and depth <= 16 and len(node.attrib) <= 100, 'XML_COMPLEXITY_LIMIT')
        return dict(tag=node.tag, attributes=dict(node.attrib), text=node.text or '', tail=node.tail or '',
                    children=[convert(child, depth + 1) for child in node])
    return bounded(convert(root))


def transform(args):
    source = rows(args['rows'])
    select, rename, constants = args.get('select'), args.get('rename', {}), args.get('set', {})
    need(select is None or type(select) is list and 1 <= len(select) <= 100 and all(type(v) is str for v in select))
    need(type(rename) is dict and type(constants) is dict)
    output = []
    for row in source:
        result = dict(row) if select is None else {name: field(row, name) for name in select}
        for old, new in rename.items():
            need(type(new) is str and new not in BAD_KEYS and new and (new == old or new not in result), 'RENAME_COLLISION')
            if old in result:
                result[new] = result.pop(old)
        result.update(constants)
        output.append(result)
    return bounded(output)


def condition(row, test):
    need(type(test) is dict and set(test) <= {'field', 'operator', 'value'} and {'field', 'operator'} <= set(test))
    actual, op, value = field(row, test['field']), test['operator'], test.get('value')
    if op == 'exists': return actual is not None
    need(op in ('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith'), 'CONDITION_OPERATOR_INVALID')
    if op == 'eq': return type(actual) is type(value) and actual == value
    if op == 'ne': return not (type(actual) is type(value) and actual == value)
    if op in ('contains', 'startsWith'):
        need(type(actual) is str and type(value) is str, 'CONDITION_TYPE_MISMATCH')
        return value in actual if op == 'contains' else actual.startswith(value)
    need(type(actual) in (int, float) and type(value) in (int, float), 'CONDITION_TYPE_MISMATCH')
    return {'gt': actual > value, 'gte': actual >= value, 'lt': actual < value, 'lte': actual <= value}[op]


def filter_rows(args):
    source, tests, mode = rows(args['rows']), args['conditions'], args.get('mode', 'all')
    need(type(tests) is list and 1 <= len(tests) <= 20 and mode in ('all', 'any'))
    return bounded([row for row in source if (all if mode == 'all' else any)(condition(row, c) for c in tests)])


def sort_rows(args):
    output, keys = list(rows(args['rows'])), args['keys']
    need(type(keys) is list and 1 <= len(keys) <= 5)
    def key(value):
        need(value is None or type(value) in (str, int, float, bool), 'SORT_SCALAR_REQUIRED')
        rank = {type(None): 0, bool: 1, int: 2, float: 2, str: 3}[type(value)]
        return rank, '' if value is None else value
    for spec in reversed(keys):
        need(type(spec) is dict and set(spec) == {'field', 'direction'} and spec['direction'] in ('asc', 'desc'))
        output.sort(key=lambda row: key(field(row, spec['field'])), reverse=spec['direction'] == 'desc')
    return output


def group_rows(args):
    groups = {}
    for row in rows(args['rows']):
        value = field(row, args['field'])
        encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        group = groups.setdefault(encoded, {'key': value, 'count': 0, 'rows': []})
        group['count'] += 1
        group['rows'].append(row)
    return bounded([groups[key] for key in sorted(groups)])


def merge_rows(args):
    left, right = rows(args['left']), rows(args['right'])
    mode = args.get('mode', 'concat')
    if mode == 'concat': return bounded(left + right)
    need(mode in ('inner', 'left') and type(args.get('key')) is str, 'MERGE_MODE_INVALID')
    index = {}
    def encoded(row): return json.dumps(field(row, args['key']), sort_keys=True, separators=(',', ':'))
    for row in right:
        k = encoded(row)
        need(k not in index, 'MERGE_RIGHT_KEY_AMBIGUOUS')
        index[k] = row
    return bounded([{'left': row, 'right': index.get(encoded(row))} for row in left
                    if mode == 'left' or encoded(row) in index])


def split_rows(args):
    source, size = bounded(args['items']), args['size']
    need(type(source) is list and type(size) is int and 1 <= size <= 1000, 'SPLIT_INVALID')
    output = [source[i:i + size] for i in range(0, len(source), size)]
    need(len(output) <= 100, 'SPLIT_LIMIT')
    return bounded(output)
