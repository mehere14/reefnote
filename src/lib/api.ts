export async function api(path: string, method = 'GET', body?: unknown) {
 const res = await fetch('/api' + path, {method, headers: body === undefined ? {} : {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
 const data = await res.json().catch(() => ({}));
 if (!res.ok) throw Object.assign(new Error(data.error || data.message || data.reason || `Request failed (${res.status})`), {status:res.status, data});
 return data;
}
