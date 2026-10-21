package com.beeper.mcp

import android.content.Context
import android.util.Log
import android.net.Uri
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.request.receiveText
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.net.NetworkInterface

/**
 * Fresh MCP HTTP implementation. No legacy SSE handler or SDK route inference.
 * Bound to loopback until an authenticated remote transport is implemented.
 */
const val BEEPER_AUTHORITY = "com.beeper.api"

class McpServer(private val context: Context) {
    companion object {
        private const val TAG = "BeeperMcp"
        private const val PORT = 8081
    }
    @Volatile private var engine: EmbeddedServer<NettyApplicationEngine, NettyApplicationEngine.Configuration>? = null
    @Volatile private var running = false

    fun isRunning(): Boolean = running

    fun start() {
        if (engine != null) return
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val candidate = embeddedServer(Netty, host = "127.0.0.1", port = PORT) {
                    routing {
                        get("/health") {
                            call.respondText("""{"status":"ok","version":"3.0.0","transport":"streamable-http","scope":"loopback"}""", ContentType.Application.Json)
                        }
                        post("/mcp") {
                            val payload = try {
                                Json.parseToJsonElement(call.receiveText()).jsonObject
                            } catch (e: Exception) {
                                call.respondText(error(null, -32700, "Parse error"), ContentType.Application.Json, HttpStatusCode.BadRequest)
                                return@post
                            }
                            val id = payload["id"]
                            val method = payload["method"]?.jsonPrimitive?.contentOrNull
                            if (method == "notifications/initialized") {
                                call.respond(HttpStatusCode.Accepted)
                                return@post
                            }
                            val result = try {
                                when (method) {
                                    "initialize" -> buildJsonObject {
                                        put("protocolVersion", "2024-11-05")
                                        put("capabilities", buildJsonObject { put("tools", buildJsonObject {}) })
                                        put("serverInfo", buildJsonObject { put("name", "beeper-mcp-server"); put("version", "3.0.0") })
                                    }
                                    "ping" -> buildJsonObject {}
                                    "tools/list" -> buildJsonObject {
                                        put("tools", buildJsonArray {
                                            add(tool("get_chats", "Read Beeper chat list", """{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":100}}}"""))
                                            add(tool("get_messages", "Read messages in Beeper chats", """{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":100},"room_id":{"type":"string"}}}"""))
                                        })
                                    }
                                    "tools/call" -> {
                                        val params = payload["params"]?.jsonObject ?: throw IllegalArgumentException("Missing params")
                                        val name = params["name"]?.jsonPrimitive?.contentOrNull
                                        val args = params["arguments"] as? JsonObject ?: buildJsonObject {}
                                        val limit = (args["limit"]?.jsonPrimitive?.intOrNull ?: 30).coerceIn(1, 100)
                                        val rows = when (name) {
                                            "get_chats" -> queryProvider("chats", limit, null)
                                            "get_messages" -> queryProvider("messages", limit, args["room_id"]?.jsonPrimitive?.contentOrNull)
                                            else -> throw IllegalArgumentException("Unknown tool")
                                        }
                                        buildJsonObject {
                                            put("content", buildJsonArray {
                                                add(buildJsonObject { put("type", "text"); put("text", rows) })
                                            })
                                        }
                                    }
                                    else -> throw IllegalArgumentException("Method not found")
                                }
                            } catch (e: IllegalArgumentException) {
                                call.respondText(error(id, -32602, e.message ?: "Invalid params"), ContentType.Application.Json)
                                return@post
                            } catch (e: Exception) {
                                Log.e(TAG, "MCP operation failed", e)
                                call.respondText(error(id, -32603, "Internal error"), ContentType.Application.Json)
                                return@post
                            }
                            if (id == null) {
                                call.respond(HttpStatusCode.Accepted)
                            } else {
                                val response = buildJsonObject {
                                    put("jsonrpc", "2.0")
                                    put("id", id)
                                    put("result", result)
                                }
                                call.respondText(response.toString(), ContentType.Application.Json)
                            }
                        }
                    }
                }
                candidate.start(wait = false)
                engine = candidate
                running = true
                Log.i(TAG, "MCP v3 started on loopback port $PORT")
            } catch (e: Exception) {
                running = false
                Log.e(TAG, "Server start failed", e)
            }
        }
    }

    private fun tool(name: String, description: String, schema: String): JsonObject = buildJsonObject {
        put("name", name)
        put("description", description)
        put("inputSchema", Json.parseToJsonElement(schema))
    }

    private fun error(id: JsonElement?, code: Int, message: String): String = buildJsonObject {
        put("jsonrpc", "2.0")
        put("id", id ?: JsonNull)
        put("error", buildJsonObject { put("code", code); put("message", message) })
    }.toString()

    private fun queryProvider(path: String, limit: Int, roomId: String?): String {
        val uri = Uri.parse("content://$BEEPER_AUTHORITY/$path")
        val output = buildJsonArray {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val columns = cursor.columnNames
                var count = 0
                while (cursor.moveToNext() && count < limit) {
                    val row = buildJsonObject {
                        columns.forEachIndexed { index, column ->
                            // Never return raw binary blobs or crash on nullable columns.
                            val value = try { cursor.getString(index) } catch (_: Exception) { null }
                            put(column, value ?: "")
                        }
                    }
                    if (roomId == null || row["roomId"]?.jsonPrimitive?.contentOrNull == roomId) {
                        add(row)
                        count++
                    }
                }
            } ?: throw IllegalStateException("Beeper provider returned no cursor")
        }
        return output.toString()
    }

    fun stop() {
        running = false
        engine?.stop(1000, 2000)
        engine = null
    }
}
