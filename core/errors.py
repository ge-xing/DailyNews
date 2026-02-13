# -*- coding: utf-8 -*-
"""
Structured error handling - provides meaningful debugging information
"""

class NanoBananaError(Exception):
    """Base exception class"""
    def __init__(self, message: str, details: dict = None):
        self.message = message
        self.details = details or {}
        super().__init__(self.message)
    
    def __str__(self):
        if self.details:
            details_str = ", ".join([f"{k}={v}" for k, v in self.details.items()])
            return f"{self.message} ({details_str})"
        return self.message

class ConfigError(NanoBananaError):
    """Configuration-related errors"""
    pass

class APIError(NanoBananaError):
    """API call-related errors"""
    def __init__(self, operation: str, message: str, details: dict = None):
        self.operation = operation
        details = details or {}
        details['operation'] = operation
        super().__init__(message, details)

class ImageProcessingError(NanoBananaError):
    """Image processing-related errors"""
    def __init__(self, stage: str, message: str, details: dict = None):
        self.stage = stage
        details = details or {}
        details['stage'] = stage
        super().__init__(message, details)