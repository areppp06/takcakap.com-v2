import os
import shutil

src_path = '/root/.gemini/antigravity-ide/brain/462719ae-513f-480a-8f8f-afe1b00ad4c0/takcakap_app_icon_1780631495336.png'
dest_dir = '/home/amp/.ampdata/instances/Development-env/foodiedash/public'

pwa_192 = os.path.join(dest_dir, 'pwa-192x192.png')
pwa_512 = os.path.join(dest_dir, 'pwa-512x512.png')

if not os.path.exists(src_path):
    print(f"Error: Source image not found at {src_path}")
    exit(1)

try:
    # Try to import PIL inside the try block
    from PIL import Image
    print(f"Opening source image: {src_path}")
    img = Image.open(src_path)
    
    # Save 512x512
    img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    img_512.save(pwa_512, 'PNG')
    print(f"Saved: {pwa_512}")
    
    # Save 192x192
    img_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
    img_192.save(pwa_192, 'PNG')
    print(f"Saved: {pwa_192}")
    
    print("Icons generated successfully!")
except ImportError:
    print("PIL (pillow) module not found. Falling back to copy original file...")
    try:
        shutil.copy(src_path, pwa_512)
        shutil.copy(src_path, pwa_192)
        print("Fallback successful: Copied original image to both sizes without resizing.")
    except Exception as copy_err:
        print(f"Fallback failed: {copy_err}")
        exit(1)
except Exception as e:
    print(f"Error during resize: {e}")
    try:
        shutil.copy(src_path, pwa_512)
        shutil.copy(src_path, pwa_192)
        print("Fallback successful: Copied original image to both sizes after resize error.")
    except Exception as copy_err:
        print(f"Fallback failed: {copy_err}")
        exit(1)
