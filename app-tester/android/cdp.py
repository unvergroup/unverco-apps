"""Minimal Chrome DevTools Protocol client (websocket-client). Also works with older Android Chrome versions."""
import json, queue, threading, time, urllib.request
import websocket  # pip: websocket-client


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30, suppress_origin=True)
        self.id, self.pending, self.events, self.lock = 0, {}, [], threading.Lock()
        self.alive = True
        self.t = threading.Thread(target=self._loop, daemon=True)
        self.t.start()

    def _loop(self):
        while self.alive:
            try:
                msg = json.loads(self.ws.recv())
            except Exception:
                if not self.alive:
                    return
                time.sleep(0.05)
                continue
            if "id" in msg:
                q = self.pending.get(msg["id"])
                if q:
                    q.put(msg)
            else:
                with self.lock:
                    self.events.append(msg)

    def send(self, method, params=None, timeout=30):
        self.id += 1
        i = self.id
        q = queue.Queue()
        self.pending[i] = q
        self.ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))
        try:
            msg = q.get(timeout=timeout)
        finally:
            self.pending.pop(i, None)
        if "error" in msg:
            raise RuntimeError(f"{method}: {msg['error']}")
        return msg.get("result", {})

    def take_events(self, names=None):
        with self.lock:
            ev = list(self.events)
        return [e for e in ev if not names or e.get("method") in names]

    def wait_event(self, name, timeout=20, since=0):
        end = time.time() + timeout
        while time.time() < end:
            with self.lock:
                for e in self.events[since:]:
                    if e.get("method") == name:
                        return True
            time.sleep(0.1)
        return False

    def close(self):
        self.alive = False
        try:
            self.ws.close()
        except Exception:
            pass


def http_json(url, method="GET"):
    req = urllib.request.Request(url, method=method)
    return json.loads(urllib.request.urlopen(req, timeout=10).read().decode())
