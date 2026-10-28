// Offline read-only export. Run as a Ghidra postScript on an authorized binary.
// @category NEXORA
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.framework.Application;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import com.google.gson.JsonObject;
import java.io.BufferedWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class NexoraExport extends GhidraScript {
    private void write(BufferedWriter out, JsonObject row) throws Exception { out.write(row.toString()); out.newLine(); }
    @Override public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1 || args.length > 3) throw new IllegalArgumentException("NexoraExport.java OUTPUT.jsonl [MAX_FUNCTIONS=5000] [TIMEOUT_SECONDS=30]");
        int max = args.length > 1 ? Integer.parseInt(args[1]) : 5000;
        int timeout = args.length > 2 ? Integer.parseInt(args[2]) : 30;
        if (max < 1 || max > 100000 || timeout < 1 || timeout > 300) throw new IllegalArgumentException("Invalid export limits");
        String digest = currentProgram.getExecutableSHA256();
        if (digest == null || !digest.matches("[a-fA-F0-9]{64}")) throw new IllegalStateException("Program lacks original binary SHA-256");
        DecompInterface decompiler = new DecompInterface();
        try (BufferedWriter out = Files.newBufferedWriter(Path.of(args[0]), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            JsonObject head = new JsonObject(); head.addProperty("kind", "header"); head.addProperty("schema", "nexora-ghidra-export/v1"); head.addProperty("binarySha256", digest); head.addProperty("version", Application.getApplicationVersion()); write(out, head);
            if (!decompiler.openProgram(currentProgram)) throw new IllegalStateException("Decompiler could not open program");
            FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
            int count = 0; long refs = 0; boolean bounded = false;
            while (functions.hasNext() && count < max) {
                monitor.checkCancelled(); Function function = functions.next();
                JsonObject row = new JsonObject(); row.addProperty("kind", "function"); row.addProperty("address", function.getEntryPoint().toString()); row.addProperty("name", function.getName());
                try {
                    DecompileResults result = decompiler.decompileFunction(function, timeout, monitor);
                    boolean ok = result.decompileCompleted() && result.getDecompiledFunction() != null;
                    row.addProperty("status", ok ? "ok" : "failed");
                    if (ok) {
                        String code = result.getDecompiledFunction().getC();
                        if (code.length() <= 200000) row.addProperty("pseudocode", code);
                        else { row.addProperty("status", "failed"); row.addProperty("message", "Pseudocode exceeds export limit"); }
                    } else row.addProperty("message", result.getErrorMessage());
                } catch (Exception error) { monitor.checkCancelled(); row.addProperty("status", "failed"); row.addProperty("message", error.getClass().getSimpleName()); }
                write(out, row); count++;
                ReferenceIterator incoming = currentProgram.getReferenceManager().getReferencesTo(function.getEntryPoint());
                while (incoming.hasNext()) {
                    monitor.checkCancelled(); if (refs >= (long) max * 20) { bounded = true; break; }
                    Reference ref = incoming.next(); JsonObject edge = new JsonObject(); edge.addProperty("kind", "reference"); edge.addProperty("from", ref.getFromAddress().toString()); edge.addProperty("to", ref.getToAddress().toString()); edge.addProperty("type", ref.getReferenceType().toString()); write(out, edge); refs++;
                }
            }
            JsonObject footer = new JsonObject(); footer.addProperty("kind", "footer"); footer.addProperty("functions", count); footer.addProperty("complete", !functions.hasNext() && !bounded); write(out, footer);
        } finally { decompiler.dispose(); }
    }
}
