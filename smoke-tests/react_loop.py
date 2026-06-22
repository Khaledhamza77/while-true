import asyncio, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.graphs.react_loop import run_graph

async def main():
    query = 'Who is the current world chess champion, when did they win the title, and what is their FIDE rating right now?'
    async for event in run_graph(query):
        t = event['type']
        if t == 'node_enter':
            print(f'[>>] {event["node"]}')
        elif t == 'node_exit':
            print(f'[<<] {event["node"]}')
        elif t == 'loop_back':
            print(f'[~~] loop back iteration={event["iteration"]}')
        elif t == 'tool_call':
            print(f'[T>] search: {event["args"]}')
        elif t == 'tool_result':
            print(f'[T<] result: {str(event["content"])[:80]}...')
        elif t == 'token':
            print(event["content"], end='', flush=True)
        elif t == 'done':
            print(f'\n[DONE] final answer length={len(event["result"])} chars')
        elif t == 'error':
            print(f'[ERR] {event["message"]}')

asyncio.run(main())