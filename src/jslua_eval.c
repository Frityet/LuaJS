#include "definitions.h"

#include "jslua_eval.h"

int jslua_call(lua_State *L, int argcount) {
  int stack = lua_gettop(L) - (argcount + 1);

  int errindex = -argcount - 2;

  lua_getglobal(L, "debug");
  lua_getfield(L, -1, "traceback");
  lua_remove(L, -2);
  lua_insert(L, errindex);

  int had_error = lua_pcall(L, argcount, LUA_MULTRET, errindex);
  lua_remove(L, 1);
  int stack_len = lua_gettop(L) - stack;

  if (had_error) {
    return -stack_len;
  }
  return stack_len;
}

int jslua_execute(lua_State *L, char *str, size_t len, char *name) {
  luaL_loadbuffer(L, str, len, name);
  if (lua_isstring(L, -1)) {
    return -1;
  }

  return jslua_call(L, 0);
}
