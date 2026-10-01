#!/usr/bin/env python3
"""Fail-closed structural checks for the OOXML subset accepted by the worker."""

import posixpath
import re
import sys
import zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree

MAX_ENTRIES = 10_000
MAX_ENTRY_BYTES = 32 * 1024 * 1024
MAX_EXPANDED_BYTES = 100 * 1024 * 1024
MAX_XML_BYTES = 8 * 1024 * 1024
MAX_RATIO = 200

REQUIRED_PART = {
    "docx": "word/document.xml",
    "pptx": "ppt/presentation.xml",
    "xlsx": "xl/workbook.xml",
    "hwpx": "Contents/content.hpf",
}

ACTIVE_PATH = re.compile(
    r"(^|/)(?:activex|embeddings|externallinks)(?:/|$)|vbaproject\.bin$",
    re.IGNORECASE,
)
ACTIVE_MARKER = re.compile(
    rb"macroEnabled|vbaProject|oleObject|activeX",
    re.IGNORECASE,
)
EXTERNAL_FORMULA = re.compile(
    rb"(?:WEBSERVICE|HYPERLINK|FILTERXML|RTD|DDE)\s*\(|(?:<f[^>]*>[^<]*\[[^\]]+\])",
    re.IGNORECASE,
)


class UnsafeDocument(Exception):
    pass


def safe_name(name: str) -> bool:
    if not name or "\\" in name or name.startswith("/"):
        return False
    path = PurePosixPath(name)
    if any(part in ("", ".", "..") for part in path.parts):
        return False
    return posixpath.normpath(name) == name.rstrip("/")


def read_bounded(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    if info.file_size > MAX_ENTRY_BYTES:
        raise UnsafeDocument("zip_entry_too_large")
    data = archive.read(info)
    if len(data) != info.file_size:
        raise UnsafeDocument("zip_entry_size_mismatch")
    return data


def validate_relationships(data: bytes) -> None:
    if len(data) > MAX_XML_BYTES:
        raise UnsafeDocument("relationship_xml_too_large")
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as error:
        raise UnsafeDocument("invalid_relationship_xml") from error
    for relationship in root.iter():
        if relationship.tag.rsplit("}", 1)[-1] != "Relationship":
            continue
        if relationship.attrib.get("TargetMode", "").lower() == "external":
            raise UnsafeDocument("external_relationship")


def validate_hwp5(path: str) -> None:
    try:
        with open(path, "rb") as stream:
            signature = stream.read(8)
    except OSError as error:
        raise UnsafeDocument("invalid_hwp5") from error
    if signature != bytes.fromhex("d0cf11e0a1b11ae1"):
        raise UnsafeDocument("invalid_hwp5_signature")


def validate(path: str, document_format: str) -> None:
    if document_format == "hwp":
        validate_hwp5(path)
        return
    required = REQUIRED_PART.get(document_format)
    if required is None:
        raise UnsafeDocument("unsupported_format")
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as error:
        raise UnsafeDocument("invalid_ooxml_zip") from error

    with archive:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_ENTRIES:
            raise UnsafeDocument("zip_entry_count")
        names = set()
        expanded = 0
        for info in infos:
            name = info.filename.rstrip("/")
            if not safe_name(info.filename):
                raise UnsafeDocument("unsafe_zip_path")
            if name in names:
                raise UnsafeDocument("duplicate_zip_entry")
            names.add(name)
            if info.flag_bits & 0x1:
                raise UnsafeDocument("encrypted_zip_entry")
            if info.file_size > MAX_ENTRY_BYTES:
                raise UnsafeDocument("zip_entry_too_large")
            expanded += info.file_size
            if expanded > MAX_EXPANDED_BYTES:
                raise UnsafeDocument("zip_expansion_too_large")
            if info.file_size and info.compress_size == 0:
                raise UnsafeDocument("invalid_zip_ratio")
            if info.compress_size and info.file_size / info.compress_size > MAX_RATIO:
                raise UnsafeDocument("zip_ratio_too_large")
            if ACTIVE_PATH.search(name):
                raise UnsafeDocument("active_or_embedded_content")

        if document_format == "hwpx":
            required_hwpx = {"mimetype", "Contents/content.hpf", "META-INF/container.xml"}
            if not required_hwpx.issubset(names):
                raise UnsafeDocument("format_part_missing")
            mimetype = read_bounded(archive, archive.getinfo("mimetype"))
            if mimetype != b"application/hwp+zip":
                raise UnsafeDocument("invalid_hwpx_mimetype")
        elif "[Content_Types].xml" not in names or required not in names:
            raise UnsafeDocument("format_part_missing")

        for info in infos:
            name = info.filename.rstrip("/")
            lower = name.lower()
            if lower.endswith(".rels"):
                validate_relationships(read_bounded(archive, info))
            if lower == "[content_types].xml":
                data = read_bounded(archive, info)
                if ACTIVE_MARKER.search(data):
                    raise UnsafeDocument("active_content_type")
            if document_format == "xlsx" and lower.startswith("xl/") and lower.endswith(".xml"):
                data = read_bounded(archive, info)
                if EXTERNAL_FORMULA.search(data):
                    raise UnsafeDocument("external_spreadsheet_formula")


def main() -> int:
    if len(sys.argv) != 3:
        print("invalid_arguments", file=sys.stderr)
        return 2
    try:
        validate(sys.argv[1], sys.argv[2])
    except UnsafeDocument as error:
        print(str(error), file=sys.stderr)
        return 3
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
