export const contextWindows:Record<string,number>={'gpt-4o':128000,'gpt-4.1':1047576,'gpt-4.1-mini':1047576,'gpt-5':400000,'claude-sonnet-4-5':200000,'claude-opus-4-1':200000,'gemini-2.5-pro':1048576,'gemini-2.5-flash':1048576};
export const modelWindow=(model:string)=>contextWindows[model]||32000;
