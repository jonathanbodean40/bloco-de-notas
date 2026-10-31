package pt.keepaligner.notaspro;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@CapacitorPlugin(name = "KeepShare")
public class KeepSharePlugin extends Plugin {
    private String packageFor(String target) {
        if ("dropbox".equals(target)) return "com.dropbox.android";
        if ("whatsapp".equals(target)) return "com.whatsapp";
        if ("gmail".equals(target)) return "com.google.android.gm";
        return null;
    }
    private void launch(Intent intent, String target, PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String packageName = packageFor(target);
                if (packageName == null) { call.reject("Destino não permitido"); return; }
                Intent direct = new Intent(intent);
                direct.setPackage(packageName);
                try { getActivity().startActivity(direct); }
                catch (ActivityNotFoundException missing) {
                    getActivity().startActivity(Intent.createChooser(intent, "Exportar nota"));
                }
                call.resolve();
            } catch (Exception e) { call.reject("Não foi possível abrir a aplicação de destino"); }
        });
    }
    @PluginMethod
    public void shareText(PluginCall call) {
        String target = call.getString("target", "");
        if (!"whatsapp".equals(target) && !"gmail".equals(target)) {
            call.reject("Destino de texto inválido"); return;
        }
        String text = call.getString("text", "");
        if (text.length() > 200000) { call.reject("Texto demasiado longo"); return; }
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("text/plain");
        intent.putExtra(Intent.EXTRA_TEXT, text);
        intent.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "Nota"));
        launch(intent, target, call);
    }
    @PluginMethod
    public void shareFile(PluginCall call) {
        String target = call.getString("target", "");
        if (!"dropbox".equals(target)) { call.reject("Destino de ficheiro inválido"); return; }
        try {
            String name = call.getString("filename", "Nota.html").replaceAll("[^A-Za-z0-9_.-]", "-");
            if (name.length() > 100) name = name.substring(name.length() - 100);
            if (!name.endsWith(".html") && !name.endsWith(".txt")) name += ".html";
            String data = call.getString("content", "");
            byte[] contents = data.getBytes(StandardCharsets.UTF_8);
            if (contents.length > 12 * 1024 * 1024) { call.reject("Ficheiro de exportação excede 12 MB"); return; }
            File folder = new File(getContext().getCacheDir(), "notes-export");
            if (!folder.exists() && !folder.mkdirs()) { call.reject("Falha ao criar pasta temporária"); return; }
            File output = new File(folder, UUID.randomUUID().toString() + "-" + name);
            try (FileOutputStream stream = new FileOutputStream(output)) {
                stream.write(contents);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", output);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(name.endsWith(".html") ? "text/html" : "text/plain");
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "Nota"));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newUri(getContext().getContentResolver(), "nota", uri));
            launch(intent, target, call);
        } catch (Exception e) { call.reject("Não foi possível preparar o ficheiro para partilha"); }
    }
}
