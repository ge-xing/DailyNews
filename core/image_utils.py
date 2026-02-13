# -*- coding: utf-8 -*-
"""
Unified image processing utilities - eliminate duplicate image processing functions
"""

import os
import uuid
from typing import List, Union
from PIL import Image, ImageOps
from .errors import ImageProcessingError

class ImageUtils:
    """Unified image processing utility class"""
    
    @staticmethod
    def load_image(path: str, max_side: int = 2048) -> Image.Image:
        """
        Unified image loading function
        Eliminates _load_image duplicate implementations
        """
        if not os.path.exists(path):
            raise ImageProcessingError("load", 
                                        f"Image file not found: {path}",
                                        {"path": path})
        
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)  # Handle EXIF rotation
        
        w, h = img.size
        scale = max(w, h) / float(max_side)
        
        if scale > 1.0:
            new_w, new_h = int(w/scale), int(h/scale)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            
        return img

    @staticmethod 
    def save_image(image: Image.Image, 
                   save_path: str) -> str:
        """
        Unified image saving function
        Eliminates _save_image duplicate implementations
        Supports various output format modes
        """
        # Ensure output directory exists
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        image.save(save_path)
        
        return save_path
        
    @staticmethod
    def batch_load_images(paths: List[str], max_side: int = 2048) -> List[Image.Image]:
        """Batch load images"""
        images = []
        errors = []
        
        for i, path in enumerate(paths):
            try:
                img = ImageUtils.load_image(path, max_side)
                images.append(img)
            except ImageProcessingError as e:
                errors.append({"index": i, "path": path, "error": str(e)})
        
        if errors and len(images) == 0:
            raise ImageProcessingError("batch_load",
                                     "Failed to load any images",
                                     {"total_paths": len(paths),
                                      "errors": errors})
        
        return images
    
    @staticmethod
    def validate_image_format(image: Image.Image) -> bool:
        """Validate if image format is valid"""
        try:
            # Try to get basic attributes
            _ = image.size
            _ = image.mode
            return True
        except Exception:
            return False