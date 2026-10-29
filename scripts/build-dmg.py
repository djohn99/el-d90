"""Build el-d90's Finder drag-to-install layout. Requires dmgbuild and Pillow."""
import argparse
import json
from pathlib import Path
import tempfile
import dmgbuild
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path, default=root / 'dist/updated/el-d90-darwin-arm64/el-d90.app')
parser.add_argument('--output', type=Path, default=root / f'dist/installers/el-d90-{version}-mac-arm64.dmg')
args = parser.parse_args()
if not args.app.is_dir():
    parser.error('Build el-d90.app first')
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='el-d90-installer-art-') as temporary:
    background = Path(temporary) / 'install.png'
    image = Image.new('RGB', (760, 440), '#f2f5f0')
    draw = ImageDraw.Draw(image)
    font = '/System/Library/Fonts/SFNS.ttf'
    def text(y, value, size, color):
        draw.text((380, y), value, font=ImageFont.truetype(font, size), anchor='mt', fill=color)
    text(40, 'Install el-d90', 32, '#193427')
    text(91, 'Drag el-d90 into Applications', 19, '#4d6555')
    draw.rounded_rectangle((326, 228, 417, 238), radius=5, fill='#789580')
    draw.polygon([(408, 211), (435, 233), (408, 255)], fill='#789580')
    text(352, 'Then open el-d90 from Applications', 16, '#4d6555')
    text(389, 'Your Kubernetes workspace', 12, '#718276')
    image.save(background)
    dmgbuild.build_dmg(str(args.output), 'el-d90', settings={
        'format': 'UDZO', 'filesystem': 'HFS+',
        'files': [str(args.app.resolve())],
        'symlinks': {'Applications': '/Applications'},
        'background': str(background),
        'window_rect': ((180, 140), (760, 440)),
        'default_view': 'icon-view', 'icon_size': 100, 'text_size': 15,
        'icon_locations': {'el-d90.app': (190, 235), 'Applications': (570, 235)},
        'show_status_bar': False, 'show_toolbar': False,
        'show_sidebar': False, 'show_tab_view': False,
    })
print(args.output)
