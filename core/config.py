# -*- coding: utf-8 -*-
"""
Unified configuration management - eliminates all duplicate configuration code
"""

import os
from typing import Optional
from google import genai
from .errors import ConfigError

GEMINI_API_KEY_ENV_VARS = ("GEMINI_API_KEY", "GOOGLE_API_KEY")


class AIConfig:
    """Unified AI configuration management class, zero duplicate configuration"""
    
    def __init__(self, 
                 api_key_path: str = "api_key.text",
                 vertex_path: str = "vertex_1.json",
                 project: str = "arctic-welder-455418-h0",
                 location: str = "us-central1"):
        self.project = project
        self.location = location
        self.vertex_path = vertex_path
        self.api_key = self._load_api_key(api_key_path)
        
        self._vertex_client: Optional[genai.Client] = None
        self._key_client: Optional[genai.Client] = None
        
        # Set Vertex AI environment variable
        if os.path.exists(vertex_path):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = vertex_path
    
    # ---------------------- 内部：Client 管理 ----------------------
    def _get_vertex_client(self) -> genai.Client:
        if self._vertex_client is None:
            if not self.project or not self.location:
                raise ValueError("使用 Vertex 需要提供 project 与 location")
            self._vertex_client = genai.Client(
                project=self.project, location=self.location, vertexai=True
            )
        return self._vertex_client

    def _get_key_client(self) -> genai.Client:
        if self._key_client is None:
            if not self.api_key:
                raise ValueError("使用 API Key 调用需要提供 api_key")
            self._key_client = genai.Client(api_key=self.api_key)
        return self._key_client

    def _load_api_key_from_env(self) -> Optional[str]:
        for env_name in GEMINI_API_KEY_ENV_VARS:
            value = os.getenv(env_name, "").strip()
            if value:
                return value
        return None

    def _load_api_key(self, api_key_path: str) -> Optional[str]:
        """Safely load API key. Prefer env vars, then fallback to local file."""
        env_key = self._load_api_key_from_env()
        if env_key:
            return env_key

        try:
            if not os.path.exists(api_key_path):
                return None
            with open(api_key_path, "r") as f:
                key = f.read().strip()
                return key if key else None
        except Exception as e:
            raise ConfigError(f"Failed to load API key from {api_key_path}", 
                            {"path": api_key_path, "error": str(e)})

    
    @property 
    def has_api_key(self) -> bool:
        """Check if valid API key exists"""
        return bool(self.api_key)
    
    @property
    def has_vertex_config(self) -> bool:
        """Check if valid Vertex configuration exists"""
        return os.path.exists(self.vertex_path)
