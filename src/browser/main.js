"use strict";

(function()
{
    var on_bios_load;

    function dump_file(ab, name)
    {
        var blob = new Blob([ab]);

        var a = document.createElement("a");
        a["download"] = name;
        a.href = window.URL.createObjectURL(blob),
        a.dataset["downloadurl"] = ["application/octet-stream", a["download"], a.href].join(":");
        
        if(document.createEvent)
        {
            var ev = document.createEvent("MouseEvent");
            ev.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
            a.dispatchEvent(ev);
        }
        else
        {
            a.click();
        }
    }

    function get_query_arguments()
    {
        var query = location.search.substr(1).split("&"),
            param,
            parameters = {};

        for(var i = 0; i < query.length; i++)
        {
            param = query[i].split("=");
            parameters[param[0]] = param[1];
        }

        return parameters;
    }

    function set_title(text)
    {
        document.title = text + " - Virtual x86" +  (DEBUG ? " - debug" : "");
    }

    function time2str(time)
    {
        if(time < 60)
        {
            return time + "s";
        }
        else if(time < 3600)
        {
            return (time / 60 | 0) + "m " + String.pad0(time % 60, 2) + "s";
        }
        else
        {
            return (time / 3600 | 0) + "h " + 
                String.pad0((time / 60 | 0) % 60, 2) + "m " + 
                String.pad0(time % 60, 2) + "s";
        }
    }

    function lock_mouse(elem)
    {
        var fn = elem["requestPointerLock"] ||
                    elem["mozRequestPointerLock"] ||
                    elem["webkitRequestPointerLock"];

        if(fn)
        {
            fn.call(elem);
        }
    }

    function chr_repeat(chr, count)
    {
        var result = "";

        while(count-- > 0)
        {
            result += chr;
        }

        return result;
    }

    function show_progress(info, e)
    {
        var el = $("loading");
        el.style.display = "block";

        if(e.lengthComputable || (info.total && typeof e.loaded === "number"))
        {
            var per100 = e.loaded / (e.total || info.total) * 100 | 0;

            per100 = Math.min(100, Math.max(0, per100));

            el.textContent = info.msg + " " + per100 + "% [" + 
                chr_repeat("#", per100 >> 1) + 
                chr_repeat(" ", 50 - (per100 >> 1)) + "]";
        }
        else
        {
            if(!info.ticks)
                info.ticks = 0;

            el.textContent = info.msg + " " + chr_repeat(".", info.ticks++ % 50);
        }
    }

    function $(id)
    {
        if(!document.getElementById(id))
            console.log("Element with id `" + id + "` not found");

        return document.getElementById(id);
    }

    function onload()
    {
        if(!("responseType" in new XMLHttpRequest))
        {
            alert("Your browser is not supported because it doesn't have XMLHttpRequest.responseType");
            return;
        }

        var settings = {
            load_devices: true
        };

        function load_local(file, type, cont)
        {
            set_title(file.name);

            // SyncFileBuffer:
            // - loads the whole disk image into memory, impossible for large files (more than 1GB)
            // - can later serve get/set operations fast and synchronously 
            // - takes some time for first load, neglectable for small files (up to 100Mb)
            //
            // AsyncFileBuffer:
            // - loads slices of the file asynchronously as requested
            // - slower get/set

            // Heuristics: If file is smaller than 64M, use SyncFileBuffer
            if(file.size < 64 * 1024 * 1024)
            {
                var loader = new v86util.SyncFileBuffer(file);
                loader.onprogress = show_progress.bind(this, { msg: "Loading disk image into memory" });
            }
            else
            {
                var loader = new v86util.AsyncFileBuffer(file);
            }

            loader.onload = function()
            {
                switch(type)
                {
                case "floppy": 
                   settings.fda = loader;
                   break;
                case "hd": 
                   settings.hda = loader;
                   break;
                case "cdrom": 
                   settings.cdrom = loader;
                   break;
                }
                cont();
            }

            loader.load();
        }

        $("toggle_mouse").onclick = function()
        {
            var mouse_adapter = settings.mouse_adapter;

            if(mouse_adapter)
            {
                var state = mouse_adapter.emu_enabled = !mouse_adapter.emu_enabled;

                $("toggle_mouse").value = (state ? "Dis" : "En") + "able mouse";
            }
        };

        $("lock_mouse").onclick = function()
        {
            var mouse_adapter = settings.mouse_adapter;

            if(mouse_adapter && !mouse_adapter.emu_enabled)
            {
                $("toggle_mouse").onclick();
            }

            lock_mouse(document.body);
            $("lock_mouse").blur();
        };

        var biosfile = DEBUG ? "seabios-debug.bin" : "seabios.bin";
        var vgabiosfile = DEBUG ? "vgabios-0.7a.debug.bin" : "bochs-vgabios-0.7a.bin";

        v86util.load_file("bios/" + biosfile, function(img)
        {
            settings.bios = img;

            if(on_bios_load) on_bios_load();
        });

        v86util.load_file("bios/" + vgabiosfile, function(img)
        {
            settings.vga_bios = img;

            if(on_bios_load) on_bios_load();
        });

        $("start_emulation").onclick = function()
        {
            $("boot_options").style.display = "none";

            var images = [];

            if($("floppy_image").files.length)
            {
                images.push({
                    file: $("floppy_image").files[0],
                    type: "floppy",
                });
            }

            if($("cd_image").files.length)
            {
                images.push({
                    file: $("cd_image").files[0],
                    type: "cdrom",
                });
            }

            if($("hd_image").files.length)
            {
                images.push({
                    file: $("hd_image").files[0],
                    type: "hd",
                });
            }

            function cont()
            {
                if(images.length === 0)
                {
                    init(settings, function(cpu)
                    {
                        cpu.run();
                    });
                }
                else
                {
                    var obj = images.pop();

                    load_local(obj.file, obj.type, cont);
                }
            }

            cont();
        };

        if(DEBUG)
        {
            debug_onload(settings);
        }

        var oses = [
            //{
            //    id: "archlinux",
            //    state: "http://localhost/v86-images/v86state.bin",
            //    //size: 137 * 1024 * 1024,
            //    size: 75550474,
            //    name: "Arch Linux",
            //    memory_size: 64 * 1024 * 1024,
            //    vga_memory_size: 8 * 1024 * 1024,
            //    async_hda: "http://localhost/v86-images/arch3.img",
            //    async_hda_size: 8 * 1024 * 1024 * 1024,
            //    filesystem: {
            //        basefs: "http://localhost/v86-images/fs.json",
            //        baseurl: "http://localhost/v86-images/arch/",
            //    },
            //},
            {
                id: "freedos",
                fda: "images/freedos722.img",
                size: 737280,
                name: "FreeDOS",
            },
            {
                id: "windows1",
                fda: "images/windows101.img",
                size: 1474560,
                name: "Windows",
            },
            {
                id: "linux26",
                cdrom: "images/linux.iso",
                size: 5666816,
                name: "Linux",
            },
            //{
            //    id: "nanolinux",
            //    cdrom: "images/nanolinux-1.2.iso",
            //    size: 14047232,
            //    name: "Nanolinux",
            //},
            {
                id: "kolibrios",
                fda: "images/kolibri.img",
                size: 1474560,
                name: "KolibriOS",
            },
            {
                id: "openbsd",
                fda: "images/openbsd.img",
                size: 1474560,
                name: "OpenBSD",
            },
            {
                id: "solos",
                fda: "images/os8.dsk",
                size: 1474560,
                name: "Sol OS",
            },
        ];

        var profile = get_query_arguments().profile;

        for(var i = 0; i < oses.length; i++)
        {
            var infos = oses[i];
            var dom_id = "start_" + infos.id;

            $(dom_id).onclick = function(infos)
            {
                var message = { msg: "Downloading image", total: infos.size };
                var image = infos.state || infos.fda || infos.cdrom;

                v86util.load_file(
                    image, 
                    loaded.bind(this, infos, settings), 
                    show_progress.bind(this, message)
                );

                var update_history;
                if(profile === infos.id)
                {
                    update_history = window.history.replaceState;
                }
                else
                {
                    update_history = window.history.pushState;
                }

                if(update_history)
                {
                    update_history.call(window.history, { profile: infos.id }, "", "?profile=" + infos.id);
                }

                set_title(infos.name);
                $(dom_id).blur();
                $("boot_options").style.display = "none";

            }.bind(this, infos);

            if(profile === infos.id)
            {
                $(dom_id).onclick();
                return;
            }
        }

        function loaded(infos, settings, buffer)
        {
            settings.memory_size = infos.memory_size;
            settings.vga_memory_size = infos.vga_memory_size;

            if(infos.async_hda)
            {
                settings.hda = new v86util.AsyncXHRBuffer(
                    infos.async_hda,
                    512, 
                    infos.async_hda_size
                );
            }

            if(infos.filesystem)
            {
                settings.fs9p = new FS(infos.filesystem.baseurl);

                if(infos.filesystem.basefs)
                {
                    settings.fs9p.LoadFilesystem({
                        lazyloadimages: [],
                        earlyload: [],
                        basefsURL: infos.filesystem.basefs,
                    });
                }
            }

            if(infos.fda)
            {
                settings.fda = new SyncBuffer(buffer);
            }
            else if(infos.cdrom)
            {
                settings.cdrom = new SyncBuffer(buffer);
            }

            init(settings, function(cpu)
            {
                if(infos.state)
                {
                    $("reset").style.display = "none";
                    cpu.restore_state(buffer);
                }

                cpu.run();
            });
        }
    }

    function debug_onload(settings)
    {
        // called on window.onload, in debug mode

        //settings.fs9p = new FS("http://localhost/v86-images/arch/");
        //settings.fs9p.LoadFilesystem({
        //    lazyloadimages: [],
        //    earlyload: [],
        //    basefsURL: "http://localhost/v86-images/fs.json",
        //});

        $("restore_state").onchange = function()
        {
            var file = $("restore_state").files[0];

            if(!file)
            {
                return;
            }

            var cpu = new v86();
            var fr = new FileReader();

            fr.onload = function(e)
            {
                init(settings, function(cpu)
                {
                    cpu.restore_state(e.target.result);
                    cpu.run();
                });
            }

            fr.readAsArrayBuffer(file);
        };

        $("start_test").onclick = function()
        {
        };

        var log_levels = document.getElementById("log_levels"),
            count = 0,
            mask;

        for(var i in dbg_names)
        {
            mask = +i;

            if(mask == 1)
                continue;

            var name = dbg_names[mask].toLowerCase(),
                input = document.createElement("input"),
                label = document.createElement("label");

            input.type = "checkbox";

            label.htmlFor = input.id = "log_" + name;

            if(LOG_LEVEL & mask)
            {
                input.checked = true;
            }
            input.mask = mask;

            label.appendChild(input);
            label.appendChild(document.createTextNode(name + " "));
            log_levels.appendChild(label);
        }

        log_levels.onchange = function(e)
        {
            var target = e.target,
                mask = target.mask;

            if(target.checked)
            {
                LOG_LEVEL |= mask;
            }
            else
            {
                LOG_LEVEL &= ~mask;
            }
        };
    }

    window.addEventListener("load", onload, false);
    window.addEventListener("popstate", onpopstate, false);

    // works in firefox and chromium
    if(document.readyState === "complete")
    {
        onload();
    }

    function init(settings, done)
    {
        if(!settings.bios || !settings.vga_bios)
        {
            on_bios_load = init.bind(this, settings, done);
            return;
        }

        var cpu = new v86();

        if(DEBUG)
        {
            debug_start(cpu);
        }

        // avoid warnings
        settings.fdb = undefined;

        settings.screen_adapter = new ScreenAdapter($("screen_container"));;
        settings.keyboard_adapter = new KeyboardAdapter();
        settings.mouse_adapter = new MouseAdapter();

        settings.boot_order = parseInt($("boot_order").value, 16);
        settings.serial_adapter = new SerialAdapter($("serial"));
        //settings.serial_adapter = new ModemAdapter();
        //settings.network_adapter = new NetworkAdapter("ws://localhost:8001/");
        //settings.network_adapter = new NetworkAdapter("ws://relay.widgetry.org/");

        if(!settings.memory_size)
        {
            var memory_size = parseInt($("memory_size").value, 10) * 1024 * 1024;
            if(memory_size >= 16 * 1024 * 1024 && memory_size < 2048 * 1024 * 1024)
            {
                settings.memory_size = memory_size;
            }
            else
            {
                alert("Invalid memory size - ignored.");
                settings.memory_size = 32 * 1024 * 1024;
            }
        }

        if(!settings.vga_memory_size)
        {
            var video_memory_size = parseInt($("video_memory_size").value, 10) * 1024 * 1024;
            if(video_memory_size > 64 * 1024 && video_memory_size < 2048 * 1024 * 1024)
            {
                settings.vga_memory_size = video_memory_size;
            }
            else
            {
                alert("Invalid video memory size - ignored.");
                settings.vga_memory_size = 8 * 1024 * 1024;
            }
        }

        init_ui(settings, cpu);
        cpu.init(settings);

        done(cpu);
    }

    function init_ui(settings, cpu)
    {
        $("boot_options").style.display = "none";
        $("loading").style.display = "none";
        $("runtime_options").style.display = "block";
        $("runtime_infos").style.display = "block";
        document.getElementsByClassName("phone_keyboard")[0].style.display = "block";

        if($("news")) 
        {
            $("news").style.display = "none";
        }

        var running = true;

        $("run").onclick = function()
        {
            if(running)
            {
                running_time += Date.now() - last_tick;
                $("run").value = "Run";
                cpu.stop();
            }
            else
            {
                $("run").value = "Pause";
                cpu.run();
                last_tick = Date.now();
            }

            running = !running;
            $("run").blur();
        };

        $("exit").onclick = function()
        {
            location.href = location.pathname;
        };

        var time = $("running_time"),
            ips = $("speed"),
            avg_ips = $("avg_speed"),
            last_tick = Date.now(),
            running_time = 0,
            summed_ips = 0,
            last_instr_counter = 0;

        function update_info()
        {
            if(!running)
            {
                setTimeout(update_info, 1000);
                return;
            }

            var now = Date.now(),
                last_ips = (cpu.timestamp_counter - last_instr_counter) / 1000 | 0;

            summed_ips += last_ips
            running_time += now - last_tick;
            last_tick = now;

            ips.textContent = last_ips;
            avg_ips.textContent = summed_ips / running_time * 1000 | 0;
            time.textContent = time2str(running_time / 1000 | 0);

            last_instr_counter = cpu.timestamp_counter;

            setTimeout(update_info, 1000);
        }

        function update_other_info()
        {
            if(!running)
            {
                setTimeout(update_other_info, 1000);
                return;
            }

            var vga_stats = cpu.devices.vga.stats;

            if(vga_stats.is_graphical)
            {
                $("info_vga_mode").textContent = "graphical";
                $("info_res").textContent = vga_stats.res_x + "x" + vga_stats.res_y;
                $("info_bpp").textContent = vga_stats.bpp;
            }
            else
            {
                $("info_vga_mode").textContent = "text";
                $("info_res").textContent = "-";
                $("info_bpp").textContent = "-";
            }

            if(settings.mouse_adapter)
            {
                $("info_mouse_enabled").textContent = settings.mouse_adapter.enabled ? "Yes" : "No";
            }

            if(cpu.devices.hda)
            {
                var hda_stats = cpu.devices.hda.stats;

                $("info_hda_sectors_read").textContent = hda_stats.sectors_read;
                $("info_hda_bytes_read").textContent = hda_stats.bytes_read;

                $("info_hda_sectors_written").textContent = hda_stats.sectors_written;
                $("info_hda_bytes_written").textContent = hda_stats.bytes_written;
                $("info_hda_status").textContent = hda_stats.loading ? "Loading ..." : "Idle";
            }
            else
            {
                $("info_hda").style.display = "none";
            }

            if(cpu.devices.cdrom)
            {
                var cdrom_stats = cpu.devices.cdrom.stats;

                $("info_cdrom_sectors_read").textContent = cdrom_stats.sectors_read;
                $("info_cdrom_bytes_read").textContent = cdrom_stats.bytes_read;
                $("info_cdrom_status").textContent = cdrom_stats.loading ? "Loading ..." : "Idle";
            }
            else
            {
                $("info_cdrom").style.display = "none";
            }

            setTimeout(update_other_info, 1000);
        }

        setTimeout(update_info, 1000);
        setTimeout(update_other_info, 0);

        $("reset").onclick = function()
        {
            cpu.restart();
            $("reset").blur();
        };

        // writable image types
        var image_types = ["hda", "hdb", "fda", "fdb"];

        for(var i = 0; i < image_types.length; i++)
        {
            var elem = $("get_" + image_types[i] + "_image");
            var obj = settings[image_types[i]];

            if(obj && obj.byteLength < 16 * 1024 * 1024)
            {
                elem.onclick = (function(type)
                {
                    obj.get_buffer(function(b)
                    {
                        dump_file(b, type + ".img");
                    });

                    this.blur();

                }).bind(elem, image_types[i]);
            }
            else
            {
                elem.style.display = "none";
            }
        }

        $("ctrlaltdel").onclick = function()
        {
            var ps2 = cpu.devices.ps2;

            ps2.kbd_send_code(0x1D); // ctrl
            ps2.kbd_send_code(0x38); // alt
            ps2.kbd_send_code(0x53); // delete

            // break codes
            ps2.kbd_send_code(0x1D | 0x80); 
            ps2.kbd_send_code(0x38 | 0x80);
            ps2.kbd_send_code(0x53 | 0x80);

            $("ctrlaltdel").blur();
        };

        $("scale").onchange = function()
        {
            var n = parseFloat(this.value);

            if(n || n > 0)
            {
                settings.screen_adapter.set_scale(n, n);
            }
        };

        $("fullscreen").onclick = function()
        {
            var elem = document.getElementById("screen_container"),

                // bracket notation because otherwise they get renamed by closure compiler
                fn = elem["requestFullScreen"] || 
                    elem["webkitRequestFullscreen"] || 
                    elem["mozRequestFullScreen"] || 
                    elem["msRequestFullScreen"];

            if(fn)
            {
                fn.call(elem);

                // This is necessary, because otherwise chromium keyboard doesn't work anymore.
                // Might (but doesn't seem to) break something else
                document.getElementsByClassName("phone_keyboard")[0].focus();
            }

            lock_mouse(elem);
        };

        $("screen_container").onclick = function()
        {
            // allow text selection
            if(window.getSelection().isCollapsed)
            {
                document.getElementsByClassName("phone_keyboard")[0].focus();
            }
        };

        $("take_screenshot").onclick = function()
        {
            settings.screen_adapter.make_screenshot();

            $("take_screenshot").blur();
        };

        if(settings.serial_adapter)
        {
            $("serial").style.display = "block";
        }

        window.addEventListener("keydown", ctrl_w_rescue, false);
        window.addEventListener("keyup", ctrl_w_rescue, false);
        window.addEventListener("blur", ctrl_w_rescue, false);

        function ctrl_w_rescue(e)
        {
            if(e.ctrlKey)
            {
                window.onbeforeunload = function()
                {
                    window.onbeforeunload = null;
                    return "CTRL-W cannot be sent to the emulator.";
                }
            }
            else
            {
                window.onbeforeunload = null;
            }
        }
    }

    function debug_start(cpu)
    {
        // called as soon as soon as emulation is started, in debug mode
        var debug = cpu.debug;

        $("step").onclick = debug.step.bind(debug);
        $("run_until").onclick = debug.run_until.bind(debug);
        $("debugger").onclick = debug.debugger.bind(debug);
        $("dump_gdt").onclick = debug.dump_gdt_ldt.bind(debug);
        $("dump_idt").onclick = debug.dump_idt.bind(debug);
        $("dump_regs").onclick = debug.dump_regs.bind(debug);
        $("dump_pt").onclick = debug.dump_page_directory.bind(debug);
        $("dump_instructions").onclick = debug.dump_instructions.bind(debug);

        $("memory_dump").onclick = function()
        {
            dump_file(debug.get_memory_dump(), "v86-memory.bin");
            $("memory_dump").blur();
        };

        $("save_state").onclick = function()
        {
            dump_file(cpu.save_state(), "v86-state.bin");
            $("save_state").blur();
        };

        window.cpu = cpu;
    }

    function onpopstate(e)
    {
        location.reload();
    }
})();
