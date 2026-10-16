"""Convert the app's PNG master into macOS/Windows icon resources (Pillow required)."""
from pathlib import Path
from PIL import Image
import sys

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'build' / 'icon.png'
output = root / 'build'
output.mkdir(exist_ok=True)
with Image.open(source) as original:
    if original.width != original.height:
        raise SystemExit('App icon master must be square')
    icon = original.convert('RGBA').resize((1024, 1024), Image.Resampling.LANCZOS)
icon.save(output / 'icon.png')
icon.save(output / 'icon.ico', sizes=[(n,n) for n in (16,24,32,48,64,128,256)])
icon.save(output / 'icon.icns')
print('Created build/icon.png, build/icon.ico and build/icon.icns')
