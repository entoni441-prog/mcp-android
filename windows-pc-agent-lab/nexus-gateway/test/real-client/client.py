"""Official MCP Python SDK against the gateway with the PC offline."""
import asyncio, os, sys, httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def main(url):
    async with httpx2.AsyncClient(timeout=10, trust_env=False) as hc:
        async with streamable_http_client(url, http_client=hc) as streams:
            async with ClientSession(streams[0], streams[1]) as s:
                init = await s.initialize()
                print('initialize:', init.server_info.name if hasattr(init, 'server_info') else init.serverInfo.name)
                tools = [t.name for t in (await s.list_tools()).tools]
                print('tools/list:', tools)
                assert tools == os.environ['EXPECTED_TOOLS'].split(','), tools
                res = await s.call_tool('get_status', {})
                err = getattr(res, 'is_error', getattr(res, 'isError', None))
                print('tools/call offline: isError=%s text=%s' % (err, res.content[0].text[:40]))
                assert err is True and 'pc_offline' in res.content[0].text
    print('REAL_CLIENT_OFFLINE_PASS')

asyncio.run(main(sys.argv[1]))
