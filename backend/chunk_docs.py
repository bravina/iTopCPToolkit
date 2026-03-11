#!/usr/bin/env python3
import json
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

class _TextExtractor(HTMLParser):
    """Strip HTML tags, but preserve code block formatting and markers."""
    def __init__(self):
        super().__init__()
        self._parts = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'nav', 'footer', 'header'):
            self._skip = True
        # NEW: Treat code tags as special markers
        if tag == 'code':
            self._parts.append(' `')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'nav', 'footer', 'header'):
            self._skip = False
        if tag == 'code':
            self._parts.append('` ')

    def handle_data(self, data):
        if not self._skip:
            self._parts.append(data)

    def get_text(self):
        # Join and collapse vertical space, but keep enough for YAML readability
        text = ''.join(self._parts)
        return text

def html_to_text(html_str):
    ext = _TextExtractor()
    ext.feed(html_str)
    return ext.get_text()

def extract_title(html_str):
    m = re.search(r'<title[^>]*>(.*?)</title>', html_str, re.DOTALL | re.IGNORECASE)
    if m:
        return html_to_text(m.group(1)).strip()
    return ''

def split_by_headings(html_str):
    """Split HTML content by h2/h3 headings into sections."""
    main_match = re.search(
        r'<(?:article|main|div[^>]*role=["\']main["\'])[^>]*>(.*)</(?:article|main|div)>',
        html_str, re.DOTALL | re.IGNORECASE
    )
    content = main_match.group(1) if main_match else html_str
    parts = re.split(r'(<h[23][^>]*>.*?</h[23]>)', content, flags=re.DOTALL | re.IGNORECASE)

    sections = []
    current_heading = ''
    current_body = ''
    for part in parts:
        if re.match(r'<h[23]', part, re.IGNORECASE):
            if current_body.strip():
                sections.append((current_heading, current_body))
            current_heading = html_to_text(part).strip()
            current_body = ''
        else:
            current_body += part
    if current_body.strip():
        sections.append((current_heading, current_body))
    return sections

def extract_keywords(text):
    """Tokenize text into unique words for indexing."""
    words = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', text.lower())
    stopwords = {'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'this', 'that'}
    return [w for w in words if len(w) > 2 and w not in stopwords]

def chunk_section(text, max_chars=1200):
    """Split long sections while trying to preserve paragraph/line breaks."""
    paragraphs = re.split(r'\n\s*\n', text)
    chunks = []
    current = ''
    for para in paragraphs:
        if len(current) + len(para) > max_chars and current:
            chunks.append(current.strip())
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current.strip())
    return chunks

def process_site(site_dir):
    site_path = Path(site_dir)
    all_chunks = []
    chunk_id = 0

    for html_file in sorted(site_path.rglob('*.html')):
        rel_path = html_file.relative_to(site_path)
        if any(part.startswith('_') for part in rel_path.parts) or rel_path.name in ('404.html', 'search.html'):
            continue

        html_str = html_file.read_text(encoding='utf-8', errors='replace')
        page_title = extract_title(html_str)
        url_path = str(rel_path).replace('index.html', '').rstrip('/')
        
        for heading, body_html in split_by_headings(html_str):
            full_text = html_to_text(body_html)
            # Remove excessive whitespace but preserve indentation
            full_text = re.sub(r'\n{3,}', '\n\n', full_text)

            for sub_chunk in chunk_section(full_text):
                if len(sub_chunk) < 50: continue
                all_chunks.append({
                    'id': chunk_id,
                    'title': page_title,
                    'section': heading,
                    'url_path': url_path,
                    'text': sub_chunk,
                    'keywords': extract_keywords(f"{page_title} {heading} {sub_chunk}")[:100]
                })
                chunk_id += 1
    return all_chunks

def main():
    if len(sys.argv) < 3:
        sys.exit(1)
    site_dir, output_path = sys.argv[1], sys.argv[2]
    chunks = process_site(site_dir) if os.path.isdir(site_dir) else []
    with open(output_path, 'w') as f:
        json.dump(chunks, f, separators=(',', ':'))
    print(f"Created {len(chunks)} chunks.")

if __name__ == '__main__':
    main()
