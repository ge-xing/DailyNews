# -*- coding: utf-8 -*-
"""
Unified Gemini API interface - eliminates duplicate API call code
"""

from typing import List, Union, Optional
from io import BytesIO
from PIL import Image
from google import genai
from .config import AIConfig
from .errors import APIError
from typing import List, Optional, Literal, Dict, Any
import time
import base64
from google import genai
from google.genai import types
from google.genai import types as genai_types
import subprocess
import importlib.util
import os
import shlex
import requests
import json 
from pathlib import Path
from urllib.parse import quote

from .image_utils import ImageUtils

import http.client
import json
import base64
import time 
import os
try:
    import oss2
except Exception:  # noqa: BLE001
    oss2 = None


def _read_oss_config_from_env_file(env_file: Path) -> dict[str, str]:
    if not env_file.exists() or not env_file.is_file():
        return {}

    spec = importlib.util.spec_from_file_location("daily_news_env", env_file)
    if spec is None or spec.loader is None:
        return {}

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {
        "access_key_id": str(getattr(module, "access_key_id", "") or ""),
        "access_key_secret": str(getattr(module, "access_key_secret", "") or ""),
        "bucket_name": str(getattr(module, "bucket_name", "") or ""),
        "endpoint": str(getattr(module, "endpoint", "") or ""),
        "public_base_url": str(getattr(module, "public_base_url", "") or ""),
        "prefix": str(getattr(module, "prefix", "") or ""),
    }


def load_oss_config(env_file: str | Path | None = None) -> dict[str, str]:
    """加载 OSS 配置。优先读取项目根目录 env.py，其次回退到环境变量。"""
    repo_root = Path(__file__).resolve().parent.parent
    env_path = Path(env_file) if env_file else (repo_root / "env.py")
    file_cfg = _read_oss_config_from_env_file(env_path)

    return {
        "access_key_id": file_cfg.get("access_key_id")
        or os.getenv("ALIYUN_OSS_ACCESS_KEY_ID", "")
        or os.getenv("OSS_ACCESS_KEY_ID", ""),
        "access_key_secret": file_cfg.get("access_key_secret")
        or os.getenv("ALIYUN_OSS_ACCESS_KEY_SECRET", "")
        or os.getenv("OSS_ACCESS_KEY_SECRET", ""),
        "bucket_name": file_cfg.get("bucket_name")
        or os.getenv("ALIYUN_OSS_BUCKET_NAME", "")
        or os.getenv("OSS_BUCKET_NAME", ""),
        "endpoint": file_cfg.get("endpoint")
        or os.getenv("ALIYUN_OSS_ENDPOINT", "")
        or os.getenv("OSS_ENDPOINT", ""),
        "public_base_url": file_cfg.get("public_base_url")
        or os.getenv("ALIYUN_OSS_PUBLIC_BASE_URL", "")
        or os.getenv("OSS_PUBLIC_BASE_URL", ""),
        "prefix": file_cfg.get("prefix")
        or os.getenv("ALIYUN_OSS_PREFIX", "")
        or os.getenv("OSS_PREFIX", ""),
    }


def _normalize_oss_endpoint(endpoint: str) -> str:
    value = (endpoint or "").strip()
    value = value.replace("https://", "").replace("http://", "")
    return value.rstrip("/")


def _build_public_oss_url(
    bucket_name: str,
    endpoint: str,
    oss_object_name: str,
    public_base_url: str | None = None,
) -> str:
    encoded_key = "/".join(quote(part) for part in oss_object_name.strip("/").split("/") if part)
    if public_base_url:
        return f"{public_base_url.rstrip('/')}/{encoded_key}"
    endpoint = _normalize_oss_endpoint(endpoint)
    return f"https://{bucket_name}.{endpoint}/{encoded_key}"


def build_public_oss_url(
    bucket_name: str,
    endpoint: str,
    oss_object_name: str,
    public_base_url: str | None = None,
) -> str:
    """对外暴露的 OSS 公网 URL 构造函数。"""
    return _build_public_oss_url(
        bucket_name=bucket_name,
        endpoint=endpoint,
        oss_object_name=oss_object_name,
        public_base_url=public_base_url,
    )


def upload_file_to_oss(
    local_file: str,
    access_key_id: str,
    access_key_secret: str,
    bucket_name: str,
    endpoint: str,
    *,
    oss_object_name: str,
    public_base_url: str | None = None,
    content_type: str | None = None,
) -> str:
    """上传任意文件到阿里云 OSS，并返回公网 URL。"""
    if oss2 is None:
        raise RuntimeError("oss2 is not installed. Run: pip install oss2")

    if not access_key_id or not access_key_secret or not bucket_name or not endpoint:
        raise ValueError("OSS credentials are incomplete (access_key_id/access_key_secret/bucket_name/endpoint)")

    local_path = Path(local_file)
    if not local_path.exists() or not local_path.is_file():
        raise FileNotFoundError(f"Local file not found: {local_file}")

    endpoint = _normalize_oss_endpoint(endpoint)
    auth = oss2.Auth(access_key_id, access_key_secret)
    bucket = oss2.Bucket(auth, endpoint, bucket_name)

    headers = None
    if content_type:
        headers = {"Content-Type": content_type}

    bucket.put_object_from_file(oss_object_name, str(local_path), headers=headers)
    return _build_public_oss_url(
        bucket_name=bucket_name,
        endpoint=endpoint,
        oss_object_name=oss_object_name,
        public_base_url=public_base_url,
    )


def upload_markdown_to_oss(
    local_file: str,
    access_key_id: str,
    access_key_secret: str,
    bucket_name: str,
    endpoint: str,
    *,
    oss_object_name: str,
    public_base_url: str | None = None,
) -> str:
    """上传 Markdown 文件到 OSS，默认 content-type 为 text/markdown。"""
    return upload_file_to_oss(
        local_file=local_file,
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        bucket_name=bucket_name,
        endpoint=endpoint,
        oss_object_name=oss_object_name,
        public_base_url=public_base_url,
        content_type="text/markdown; charset=utf-8",
    )


def upload_text_to_oss(
    text: str,
    access_key_id: str,
    access_key_secret: str,
    bucket_name: str,
    endpoint: str,
    *,
    oss_object_name: str,
    public_base_url: str | None = None,
    content_type: str = "text/plain; charset=utf-8",
) -> str:
    """上传文本内容到 OSS，并返回公网 URL。"""
    if oss2 is None:
        raise RuntimeError("oss2 is not installed. Run: pip install oss2")

    if not access_key_id or not access_key_secret or not bucket_name or not endpoint:
        raise ValueError("OSS credentials are incomplete (access_key_id/access_key_secret/bucket_name/endpoint)")

    endpoint = _normalize_oss_endpoint(endpoint)
    auth = oss2.Auth(access_key_id, access_key_secret)
    bucket = oss2.Bucket(auth, endpoint, bucket_name)
    bucket.put_object(
        oss_object_name,
        text.encode("utf-8"),
        headers={"Content-Type": content_type},
    )
    return _build_public_oss_url(
        bucket_name=bucket_name,
        endpoint=endpoint,
        oss_object_name=oss_object_name,
        public_base_url=public_base_url,
    )


def upload_json_to_oss(
    payload: dict | list,
    access_key_id: str,
    access_key_secret: str,
    bucket_name: str,
    endpoint: str,
    *,
    oss_object_name: str,
    public_base_url: str | None = None,
) -> str:
    """上传 JSON 到 OSS，并返回公网 URL。"""
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    return upload_text_to_oss(
        text=text + "\n",
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        bucket_name=bucket_name,
        endpoint=endpoint,
        oss_object_name=oss_object_name,
        public_base_url=public_base_url,
        content_type="application/json; charset=utf-8",
    )

def upload_to_oss(local_file, access_key_id, access_key_secret, bucket_name, endpoint):
    """
    上传文件到阿里云 OSS，并返回文件的公共 URL。

    :param local_file: 本地文件路径
    :param oss_object_name: 在 OSS 上存储的文件名（即图片的 URL）
    :param access_key_id: 阿里云 AccessKey ID
    :param access_key_secret: 阿里云 AccessKey Secret
    :param bucket_name: 阿里云 OSS 存储空间（Bucket）的名称
    :param endpoint: 阿里云 OSS 的 endpoint（根据区域选择）
    :return: 上传成功返回文件的公共 URL，上传失败返回错误信息
    """
    file_name = Path(local_file).name
    oss_object_name = f"images/{file_name}"

    try:
        public_url = upload_file_to_oss(
            local_file=local_file,
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
            bucket_name=bucket_name,
            endpoint=endpoint,
            oss_object_name=oss_object_name,
        )
        print(f"File '{local_file}' uploaded successfully to OSS as '{oss_object_name}'")
        return public_url
    except Exception as e:  # noqa: BLE001
        print(f"Error occurred while uploading: {e}")
        return str(e)

# 默认读取项目根目录 env.py（可回退到环境变量）：
_DEFAULT_OSS_CONFIG = load_oss_config()
access_key_id = _DEFAULT_OSS_CONFIG["access_key_id"]
access_key_secret = _DEFAULT_OSS_CONFIG["access_key_secret"]
bucket_name = _DEFAULT_OSS_CONFIG["bucket_name"]
endpoint = _DEFAULT_OSS_CONFIG["endpoint"] or "oss-cn-beijing.aliyuncs.com"


class GeminiAPI:
    """Unified Gemini API interface"""
    
    def __init__(self, config: AIConfig):
        self.config = config
        self._vertex_client = config._get_vertex_client()
        self._key_client = config._get_key_client()

    def generate_content(
        self,
        contents,
        model: str = "gemini-2.5-flash",
    ):
        # client = self._vertex_client
        client = self._key_client
        print(f"start generate content...")
        time.sleep(5)
        return client.models.generate_content(model=model, contents=contents)

    def edit_image(
        self,
        image_parts,
        instructions: str,
        save_path,
        model: str = "gemini-2.5-flash-image",
    ):
        client = self._key_client
        contents = [instructions] + image_parts
        response = client.models.generate_content(model=model, contents=contents,
                                                    # config=types.GenerateContentConfig(
                                                    # image_config=types.ImageConfig(
                                                        # aspect_ratio="16:9",
                                                        # aspect_ratio="1:1",
                                                    # )
        # ))
        )

        print(f"response: {response}")
        image_path = self.decode_images_from_response(response)
        if not image_path:
            print(f"模型未返回图片")
            raise Exception("no image returned, please retry")
            # return None

        print(f"image_path: {image_path}")

        ImageUtils.save_image(image_path[0], save_path)

        time.sleep(5)
        return save_path


    def generate_image(
        self,
        prompt: str,
        save_path,
        model: str = "gemini-2.5-flash-image",
    ):
        """文生图。
        save_dir 若提供，会将返回的图片依次保存为 {prefix}_{idx}.png。
        """
        client = self._key_client
        response = client.models.generate_content(model=model, contents=[prompt],
        #                                     config=types.GenerateContentConfig(
        #                                     image_config=types.ImageConfig(
        #                                                 aspect_ratio="16:9",
        #                                     )
        # ))
        )

        print(f"response: {response}")
        image_path = self.decode_images_from_response(response)
        if not image_path:
            print(f"no image returned, please retry")
            # exit(0)
            raise Exception("no image returned, please retry")
            return None

        print(f"image_path: {image_path}")

        ImageUtils.save_image(image_path[0], save_path)

        time.sleep(5)
        return save_path

    
    def image_to_video(
        self,
        prompt: str,
        starting_image_path: str,
        save_path: str,
        *,
        # model: str = "veo-3.0-generate-001",
        model: str = "veo-3.1-fast-generate-preview",
        aspect_ratio: Literal["16:9", "9:16"] = "16:9",
        duration_seconds: Literal[8] = 4,
        resolution: Literal["1080p", "720p"] = "1080p",
        enhance_prompt: bool = True,
        generate_audio: bool = True,
        person_generation: Literal["allow_adult", "dont_allow"] = "allow_adult",
        output_gcs_uri: Optional[str] = None,
        poll_seconds: int = 10,
    ):
        if genai_types is None:
            raise RuntimeError("google.genai.types 未可用，无法进行视频生成功能。请升级 google-genai 或检查安装。")

        client = self._key_client
        op = client.models.generate_videos(
            model=model,
            prompt=prompt,
            image=genai_types.Image.from_file(location=starting_image_path),
            config=genai_types.GenerateVideosConfig(
                aspect_ratio=aspect_ratio,
                number_of_videos=1,
                duration_seconds=duration_seconds,
                # resolution=resolution,
                # person_generation=person_generation,
                # enhance_prompt=enhance_prompt,
                # generate_audio=generate_audio,
                # output_gcs_uri=output_gcs_uri,
            ),
        )

        while not op.done:
            time.sleep(poll_seconds)
            op = client.operations.get(op)

        print(f"op is {op}")

        # Download the generated video.
        generated_video = op.response.generated_videos[0]
        client.files.download(file=generated_video.video)
        generated_video.video.save(save_path)
        print(f"Generated video saved to {save_path}")

        time.sleep(1)
        return save_path
    
   
    def decode_images_from_response(self, response):
        out = []
        for part in response.candidates[0].content.parts:
            if getattr(part, "inline_data", None) is not None:
                try:
                    data = base64.b64decode(part.inline_data.data)
                    out.append(Image.open(BytesIO(data)))
                except Exception as e:
                    print(f"error: {e}")
                    out.append(Image.open(BytesIO(part.inline_data.data)))
        return out
