"""Server fixture for python-backends.mdx. Requires flask and gunicorn:
    pip install flask gunicorn

Run with:
    gunicorn -w 4 --bind 127.0.0.1:4000 flask_app:app
"""

import time

from flask import Flask, jsonify

app = Flask(__name__)


@app.get("/fast")
def fast():
    return jsonify({"ok": True})


@app.get("/block")
def block():
    time.sleep(0.02)
    return jsonify({"ok": True})
